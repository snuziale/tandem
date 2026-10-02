// One chat turn: read-only context in, prose + proposed actions out.
//
// The fourth pass of the agent, and the only interactive one. Everything the
// pipeline guarantees still holds — no write tools exist, GitHub is only ever
// read. A file it cannot see is a SERVER-side hop through the read-only
// GitHub client (needContext) — or, for a `repo`-context profile, a Read/Grep
// inside the same confined read-only checkout the pipeline uses.
//
// Turns are server-owned: closing the pane detaches, the transcript lands in
// chats.json either way, and cancel is the only kill switch.
import { randomUUID } from "node:crypto";
import {
  ChatTailSchema,
  type ChatActionJson,
} from "../../../shared/chat-schema";
import {
  chatKeyOf,
  newChatSession,
  type ChatAnchor,
  type ChatEvent,
  type ChatMessage,
  type ChatScope,
  type ChatSession,
} from "../../../shared/chat-types";
import { diffLineIndex, type DiffLineIndex } from "../../../shared/gh/patch";
import { parsePrId, repoKeyOfRef } from "../../../shared/gh/prKey";
import { toolTargetOf } from "../../../shared/agent-context";
import {
  agentById,
  effectiveContext,
  type EffectiveContext,
} from "../../../shared/settings-types";
import type { Config } from "../../config/store";
import { loadReview } from "../../reviews/store";
import { loadSettings } from "../../settings/store";
import { runClaudePass, type ToolTurn } from "../claude";
import { acquireWorktree, readCheckoutFile, type Worktree } from "../worktree";
import { createLive, finishLive, isLive, publish } from "../live";
import { fetchRepoGuidance } from "../pipeline/context";
import { addSpend, getRun, spendToday } from "../runsIndex";
import { sanitizeChatActions } from "./actions";
import { fetchFileAtSha, loadChatSource } from "./context";
import { buildChatPrompt } from "./prompt";
import { createFenceGate, splitTrailingJson } from "./prose";
import { clearStuckStatus, getSession, updateSession } from "./store";

/** How many times a single turn may ask the server for more files. */
const MAX_CONTEXT_HOPS = 2;
const MAX_QUESTION_CHARS = 4000;
/** `@path` mentions the reviewer typed. Pre-loaded before hop 0, which is the
 * point: naming the file up front skips the needContext round trip entirely,
 * and that hop is a whole model call. */
const MAX_MENTIONED_PATHS = 3;
/** Turn cap inside a checkout. Lower than a pipeline pass's: the reviewer is
 * watching this one. */
const CHAT_MAX_TURNS = 16;

export type ChatTurnOptions = {
  message: string;
  agentId?: string;
  /** Where the reviewer was pointing when they asked. */
  anchor?: ChatAnchor;
  /** Files named with `@path` in the composer. */
  contextPaths?: string[];
};

export async function startChatTurn(
  cfg: Config,
  scope: ChatScope,
  opts: ChatTurnOptions,
): Promise<{ session: ChatSession }> {
  const question = opts.message.trim();
  if (!question) throw new Error("empty message");
  if (question.length > MAX_QUESTION_CHARS)
    throw new Error(`message too long (max ${MAX_QUESTION_CHARS} characters)`);
  const ref = parsePrId(scope.prId);
  if (!ref) throw new Error(`malformed prId: ${scope.prId}`);

  const sessionId = chatKeyOf(scope.prId, scope.headSha, scope.findingId);
  if (isLive(sessionId))
    throw new Error("this conversation is already thinking");
  // A crash can leave `thinking` behind; nothing is driving it now.
  await clearStuckStatus(sessionId);

  const settings = await loadSettings();
  // The profile that produced the findings answers about them — asking "why
  // did you flag this?" of an architecture run should reach the architecture
  // reviewer. Read from the RUN RECORD, not from the client: runs are
  // server-owned, and the pane's copy of one comes from a 30s poll. An
  // explicit agentId still wins, for an "ask another lens" affordance that
  // does not exist yet.
  const run = await getRun(scope.prId, scope.headSha);
  const agent = agentById(settings, opts.agentId ?? run?.agentId);
  // Chat spends from the same daily ceiling as runs — one budget, one story.
  const spent = await spendToday();
  if (settings.dailyCostUsd > 0 && spent >= settings.dailyCostUsd)
    throw new Error(
      `daily agent budget spent ($${spent.toFixed(2)} of $${settings.dailyCostUsd.toFixed(2)})`,
    );

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: "user",
    text: question,
    createdAt: new Date().toISOString(),
    anchor: opts.anchor,
  };
  const session = await updateSession(scope, (s) => {
    s.messages.push(userMessage);
    s.status = "thinking";
  });

  const signal = createLive(sessionId, scope.prId, "chat", {
    headSha: scope.headSha,
    agentName: agent.name,
  });
  const ctx = effectiveContext(settings, agent, repoKeyOfRef(ref));
  void drive(cfg, scope, sessionId, agent, ctx, question, opts, signal).catch(
    (e) => {
      console.error(`[chat] turn ${sessionId} crashed:`, e);
    },
  );

  return { session };
}

async function drive(
  cfg: Config,
  scope: ChatScope,
  sessionId: string,
  agent: ReturnType<typeof agentById>,
  ctx: EffectiveContext,
  question: string,
  opts: ChatTurnOptions,
  signal: AbortSignal,
): Promise<void> {
  const emit = (event: ChatEvent) => publish(sessionId, event);
  let tokens = 0;
  let cost = 0;
  const contextRead: string[] = [];
  let worktree: Worktree | null = null;

  try {
    emit({ type: "status", label: "reading the pull request" });
    const ref = parsePrId(scope.prId)!;
    // Independent reads, together — the reviewer watches a spinner for all
    // of them, and a cold checkout (possibly a fetch) is the slow one.
    const [{ detail, files }, run, review, guidance, checkout, stored] =
      await Promise.all([
        loadChatSource(cfg, ref, scope.prId, scope.headSha, signal),
        getRun(scope.prId, scope.headSha),
        loadReview(scope.prId),
        fetchRepoGuidance(cfg, ref, scope.headSha),
        ctx.depth === "repo"
          ? acquireWorktree(ctx.localPath, ref, scope.headSha).then(
              (w) => ({ worktree: w }),
              (e: unknown) => ({
                error: e instanceof Error ? e.message : String(e),
              }),
            )
          : null,
        getSession(sessionId),
      ]);
    if (checkout && "worktree" in checkout) worktree = checkout.worktree;
    else if (checkout) {
      // A turn without the checkout still answers — from the diff and
      // needContext hops, exactly like a `files` profile — and says why.
      console.error(
        `[chat] ${sessionId}: checkout unavailable: ${checkout.error}`,
      );
      emit({
        type: "status",
        label: "no checkout — answering from the diff",
      });
    }
    const focused = scope.findingId
      ? (run?.findings.find((f) => f.id === scope.findingId) ?? null)
      : null;
    const history = stored?.messages ?? [];
    // The question we just persisted is passed separately, not twice.
    const priorHistory = history.slice(0, -1);

    const withPatch = files.filter((f) => f.patch !== undefined);
    const lineIndexByPath = new Map<string, DiffLineIndex>(
      withPatch.map((f) => [f.path, diffLineIndex(f.patch!)]),
    );
    const patchByPath = new Map<string, string>(
      withPatch.map((f) => [f.path, f.patch!]),
    );

    const extraContext: Array<{ path: string; text: string }> = [];
    // `@path` mentions are fetched BEFORE the first pass rather than waiting
    // for the model to ask: the reviewer already named the file, and a
    // needContext hop costs a full re-ask.
    //
    // A file already in the diff is NOT skipped, and that was a real bug: the
    // client resolves a mention against the diff's own paths, so filtering out
    // everything in the diff made the two exact complements and nothing was
    // ever fetched. The diff carries HUNKS — naming a file is how the reviewer
    // asks for the whole thing.
    const mentioned = (opts.contextPaths ?? []).slice(0, MAX_MENTIONED_PATHS);
    // Concurrent: these are independent reads on the turn's critical path, and
    // the reviewer is watching a spinner for all of them.
    if (mentioned.length) {
      emit({ type: "status", label: `reading ${mentioned.join(", ")}` });
      // Off the checkout's disk when there is one — it is the same commit.
      const root = worktree?.path;
      const fetched = await Promise.all(
        mentioned.map(async (path) => ({
          path,
          text: root
            ? await readCheckoutFile(root, path)
            : await fetchFileAtSha(cfg, ref, path, scope.headSha),
        })),
      );
      if (signal.aborted) throw new Error("cancelled");
      for (const { path, text } of fetched) {
        if (text === null) continue;
        extraContext.push({ path, text });
        contextRead.push(path);
      }
    }
    // No `context` frame here on purpose: that frame means "I threw away the
    // answer I was writing and went to read something", and a pre-load did
    // neither. The files still land on the message's contextRead.
    let prose = "";
    let tail: unknown = null;

    for (let hop = 0; ; hop++) {
      if (signal.aborted) throw new Error("cancelled");
      emit({ type: "status", label: hop === 0 ? "thinking" : "re-reading" });
      let gate = createFenceGate();
      const prompt = buildChatPrompt({
        prompts: agent.prompts,
        pr: detail.pr,
        files,
        guidance,
        checkout: worktree
          ? { repo: repoKeyOfRef(ref), sha: scope.headSha }
          : undefined,
        run,
        focused,
        anchor: opts.anchor ?? null,
        threads: detail.threads,
        review,
        history: priorHistory,
        question,
        extraContext,
      });
      // Inside a checkout the model reads mid-answer, and the CLI's result is
      // the FINAL message only — so the boundary that matters is a message
      // that ended in tool calls, whatever the tools were. Prose streamed
      // before it is not the answer: it goes out as ONE `context` frame and
      // the pane files it under "asked for X" rather than deleting it. A tool
      // turn with no prose before it is just a status line.
      let wroteSinceTurn = false;
      const onToolTurn = ({ uses }: ToolTurn) => {
        const targets = uses.map((use) => {
          const path = worktree ? toolTargetOf(use.input, worktree.path) : null;
          if (use.name === "Read" && path) {
            if (!contextRead.includes(path)) contextRead.push(path);
            return path;
          }
          const pattern =
            typeof use.input.pattern === "string" ? use.input.pattern : "";
          return pattern ? `search: ${pattern}` : "the repo";
        });
        if (wroteSinceTurn) emit({ type: "context", paths: targets });
        else emit({ type: "status", label: `reading ${targets.join(", ")}` });
        wroteSinceTurn = false;
        gate = createFenceGate();
      };
      const result = await runClaudePass({
        prompt,
        model: agent.models.chat,
        signal,
        onDelta: (text) => {
          const visible = gate.push(text);
          if (visible) {
            wroteSinceTurn = true;
            emit({ type: "delta", text: visible });
          }
        },
        checkout: worktree
          ? { cwd: worktree.path, maxTurns: CHAT_MAX_TURNS }
          : undefined,
        onToolTurn,
      });
      tokens += result.tokens;
      cost += result.costUsd;
      if (!result.ok) throw new Error(result.error);
      const trailing = gate.flush();
      if (trailing) emit({ type: "delta", text: trailing });

      const split = splitTrailingJson(result.text);
      prose = split.prose;
      tail = split.tail;

      const parsed = ChatTailSchema.safeParse(tail ?? {});
      const need = parsed.success ? (parsed.data.needContext ?? []) : [];
      if (need.length === 0 || hop >= MAX_CONTEXT_HOPS) break;

      // Fetch what it asked for and re-ask. The model never names the repo —
      // owner/repo come from the session's own PR.
      const fetched: string[] = [];
      for (const want of need) {
        if (extraContext.some((c) => c.path === want.path)) continue;
        const text = await fetchFileAtSha(cfg, ref, want.path, scope.headSha);
        extraContext.push({
          path: want.path,
          text: text ?? "(not found at this sha)",
        });
        fetched.push(want.path);
      }
      if (fetched.length === 0) break; // asked for nothing new — stop looping
      contextRead.push(...fetched);
      emit({ type: "context", paths: fetched });
    }

    const parsed = ChatTailSchema.safeParse(tail ?? {});
    if (tail !== null && !parsed.success) {
      console.error(
        `[chat] ${sessionId}: trailing JSON failed validation, dropped: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const proposedActions: ChatActionJson[] = parsed.success
      ? (parsed.data.actions ?? [])
      : [];
    const { actions, discarded } = sanitizeChatActions(proposedActions, {
      run,
      review,
      lineIndexByPath,
      patchByPath,
      threads: detail.threads,
    });
    if (discarded > 0)
      console.error(
        `[chat] ${sessionId}: discarded ${discarded} unusable action(s)`,
      );

    const answer: ChatMessage = {
      id: randomUUID(),
      role: "agent",
      text: prose || "(no answer)",
      createdAt: new Date().toISOString(),
      agentId: agent.id,
      agentName: agent.name,
      actions: actions.length ? actions : undefined,
      contextRead: contextRead.length ? contextRead : undefined,
      tokens,
      costUsd: cost,
    };
    const session = await finish(scope, answer, tokens, cost);
    await addSpend(cost);
    emit({ type: "turn-end", session });
  } catch (e) {
    const message = signal.aborted
      ? "cancelled"
      : e instanceof Error
        ? e.message
        : String(e);
    const failed: ChatMessage = {
      id: randomUUID(),
      role: "agent",
      text: "",
      createdAt: new Date().toISOString(),
      agentId: agent.id,
      agentName: agent.name,
      error: message,
      tokens,
      costUsd: cost,
    };
    const session = await finish(scope, failed, tokens, cost).catch(() =>
      newChatSession(scope),
    );
    if (cost > 0) await addSpend(cost);
    emit({ type: "error", message });
    emit({ type: "turn-end", session });
  } finally {
    worktree?.release();
    finishLive(sessionId);
  }
}

async function finish(
  scope: ChatScope,
  message: ChatMessage,
  tokens: number,
  cost: number,
): Promise<ChatSession> {
  return updateSession(scope, (s) => {
    s.messages.push(message);
    s.status = "idle";
    s.tokensUsed += tokens;
    s.costUsd += cost;
  });
}
