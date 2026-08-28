// One chat turn: read-only context in, prose + proposed actions out.
//
// The fourth pass of the agent, and the only interactive one. Everything the
// pipeline guarantees still holds — `--safe-mode --tools ''`, no write tools
// exist, GitHub is only ever read — and the one new capability (the agent can
// ask for a file it cannot see) is a SERVER-side hop through the read-only
// GitHub client, not a tool in the model's hands.
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
  type ChatEvent,
  type ChatMessage,
  type ChatScope,
  type ChatSession,
} from "../../../shared/chat-types";
import { diffLineIndex, type DiffLineIndex } from "../../../shared/gh/patch";
import { parsePrId } from "../../../shared/gh/prKey";
import { agentById } from "../../../shared/settings-types";
import type { Config } from "../../config/store";
import { loadReview } from "../../reviews/store";
import { loadSettings } from "../../settings/store";
import { runClaudePass } from "../claude";
import { createLive, finishLive, isLive, publish } from "../live";
import { fetchConventions } from "../pipeline/context";
import { addSpend, getRun, spendToday } from "../runsIndex";
import { sanitizeChatActions } from "./actions";
import { fetchFileAtSha, loadChatSource } from "./context";
import { buildChatPrompt } from "./prompt";
import { createFenceGate, splitTrailingJson } from "./prose";
import { clearStuckStatus, getSession, updateSession } from "./store";

/** How many times a single turn may ask the server for more files. */
const MAX_CONTEXT_HOPS = 2;
const MAX_QUESTION_CHARS = 4000;

export async function startChatTurn(
  cfg: Config,
  scope: ChatScope,
  opts: { message: string; agentId?: string },
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
  const agent = agentById(settings, opts.agentId);
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
  };
  const session = await updateSession(scope, (s) => {
    s.messages.push(userMessage);
    s.status = "thinking";
  });

  const signal = createLive(sessionId, scope.prId, "chat", {
    headSha: scope.headSha,
    agentName: agent.name,
  });
  void drive(cfg, scope, sessionId, agent, question, signal).catch((e) => {
    console.error(`[chat] turn ${sessionId} crashed:`, e);
  });

  return { session };
}

async function drive(
  cfg: Config,
  scope: ChatScope,
  sessionId: string,
  agent: ReturnType<typeof agentById>,
  question: string,
  signal: AbortSignal,
): Promise<void> {
  const emit = (event: ChatEvent) => publish(sessionId, event);
  let tokens = 0;
  let cost = 0;
  const contextRead: string[] = [];

  try {
    emit({ type: "status", label: "reading the pull request" });
    const ref = parsePrId(scope.prId)!;
    const { detail, files } = await loadChatSource(
      cfg,
      ref,
      scope.prId,
      scope.headSha,
      signal,
    );
    const run = await getRun(scope.prId, scope.headSha);
    const review = await loadReview(scope.prId);
    const conventions = await fetchConventions(cfg, ref, scope.headSha);
    const focused = scope.findingId
      ? (run?.findings.find((f) => f.id === scope.findingId) ?? null)
      : null;
    const history = (await getSession(sessionId))?.messages ?? [];
    // The question we just persisted is passed separately, not twice.
    const priorHistory = history.slice(0, -1);

    const lineIndexByPath = new Map<string, DiffLineIndex>(
      files
        .filter((f) => f.patch !== undefined)
        .map((f) => [f.path, diffLineIndex(f.patch!)]),
    );

    const extraContext: Array<{ path: string; text: string }> = [];
    let prose = "";
    let tail: unknown = null;

    for (let hop = 0; ; hop++) {
      if (signal.aborted) throw new Error("cancelled");
      emit({ type: "status", label: hop === 0 ? "thinking" : "re-reading" });
      const gate = createFenceGate();
      const prompt = buildChatPrompt({
        prompts: agent.prompts,
        pr: detail.pr,
        files,
        conventions,
        run,
        focused,
        threads: detail.threads,
        review,
        history: priorHistory,
        question,
        extraContext,
      });
      const result = await runClaudePass({
        prompt,
        model: agent.models.chat,
        signal,
        onDelta: (text) => {
          const visible = gate.push(text);
          if (visible) emit({ type: "delta", text: visible });
        },
      });
      if (!result.ok) throw new Error(result.error);
      const trailing = gate.flush();
      if (trailing) emit({ type: "delta", text: trailing });
      tokens += result.tokens;
      cost += result.costUsd;

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
