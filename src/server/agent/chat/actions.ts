// The safety layer between a chat turn's proposals and the reviewer's state.
//
// Two gates, both mandatory:
//   1. sanitizeChatActions — before the reviewer ever SEES a chip: every id
//      must exist, every transition must be legal, every new finding must
//      anchor to a real diff line (same check pass 2 output gets).
//   2. applyChatAction — when the reviewer CLICKS: re-validate against current
//      state, because the finding may have been staged, dismissed or gone
//      stale since the answer arrived.
// Model output stays untrusted at both.
import { randomUUID } from "node:crypto";
import {
  canTransitionFinding,
  type AgentRun,
  type Finding,
} from "../../../shared/agent-types";
import type { ChatActionJson } from "../../../shared/chat-schema";
import type { ChatAction, ChatSession } from "../../../shared/chat-types";
import type { DiffLineIndex } from "../../../shared/gh/patch";
import type { PendingReview, ReviewThread } from "../../../shared/review-types";
import { loadReview, saveReview } from "../../reviews/store";
import { sanitizeFindings } from "../pipeline/parse";
import {
  appendFinding,
  getRun,
  reviseFinding,
  transitionFinding,
} from "../runsIndex";
import { getSession, updateSessionById } from "./store";

export type SanitizeContext = {
  run: AgentRun | null;
  review: PendingReview | null;
  lineIndexByPath: Map<string, DiffLineIndex>;
  threads: ReviewThread[];
  /** Injected so the sanitizer stays deterministic under test. */
  newId?: () => string;
};

export function sanitizeChatActions(
  proposed: ChatActionJson[],
  ctx: SanitizeContext,
): { actions: ChatAction[]; discarded: number } {
  const newId = ctx.newId ?? randomUUID;
  const actions: ChatAction[] = [];
  let discarded = 0;

  for (const p of proposed) {
    const base = { id: newId(), state: "proposed" as const, why: p.why };

    if (p.kind === "revise-finding") {
      const finding = findingOf(ctx.run, p.findingId);
      // A staged finding's text lives in the draft comment — the model was
      // told to propose revise-comment for those.
      if (
        !finding ||
        (finding.state !== "proposed" && finding.state !== "edited")
      ) {
        discarded++;
        continue;
      }
      const hasChange =
        p.title !== undefined ||
        p.body !== undefined ||
        p.severity !== undefined ||
        p.suggestion !== undefined;
      if (!hasChange) {
        discarded++;
        continue;
      }
      actions.push({
        ...base,
        kind: "revise-finding",
        findingId: finding.id,
        title: p.title,
        body: p.body,
        severity: p.severity,
        suggestion: p.suggestion,
      });
      continue;
    }

    if (p.kind === "dismiss-finding") {
      const finding = findingOf(ctx.run, p.findingId);
      if (!finding || !canTransitionFinding(finding.state, "dismissed")) {
        discarded++;
        continue;
      }
      actions.push({ ...base, kind: "dismiss-finding", findingId: finding.id });
      continue;
    }

    if (p.kind === "new-finding") {
      if (!ctx.run || ctx.run.status !== "ready") {
        discarded++;
        continue;
      }
      // Exactly the pass-2 gate: real anchor, and silent where a human already spoke.
      const { kept } = sanitizeFindings(
        [p.finding],
        ctx.lineIndexByPath,
        ctx.threads,
      );
      if (kept.length === 0) {
        discarded++;
        continue;
      }
      actions.push({ ...base, kind: "new-finding", finding: kept[0] });
      continue;
    }

    // revise-comment
    const comment = ctx.review?.comments.find((c) => c.localId === p.localId);
    if (!comment) {
      discarded++;
      continue;
    }
    actions.push({
      ...base,
      kind: "revise-comment",
      localId: comment.localId,
      body: p.body,
    });
  }

  return { actions, discarded };
}

function findingOf(run: AgentRun | null, findingId: string): Finding | null {
  return run?.findings.find((f) => f.id === findingId) ?? null;
}

export type ApplyResult = { session: ChatSession; runId?: string };

/**
 * Apply one proposed action. Human-triggered only — this is the whole reason
 * chat can suggest edits without breaking invariant §1: the agent proposes,
 * the reviewer clicks, and GitHub still only hears from submit.ts.
 */
export async function applyChatAction(
  sessionId: string,
  actionId: string,
): Promise<ApplyResult> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`no chat session ${sessionId}`);
  const action = findAction(session, actionId);
  if (!action) throw new Error(`no action ${actionId} in this conversation`);
  if (action.state === "applied") return { session };

  let runId: string | undefined;
  switch (action.kind) {
    case "revise-finding": {
      const run = await runOwning(session, action.findingId);
      await reviseFinding(run.id, action.findingId, {
        title: action.title,
        body: action.body,
        severity: action.severity,
        suggestion: action.suggestion,
      });
      runId = run.id;
      break;
    }
    case "dismiss-finding": {
      const run = await runOwning(session, action.findingId);
      await transitionFinding(run.id, action.findingId, "dismissed");
      runId = run.id;
      break;
    }
    case "new-finding": {
      const run = await runForSession(session);
      const finding: Finding = {
        ...action.finding,
        id: randomUUID(),
        runId: run.id,
        prId: session.prId,
        headSha: session.headSha,
        state: "proposed",
      };
      await appendFinding(run.id, finding);
      runId = run.id;
      break;
    }
    case "revise-comment": {
      const review = await loadReview(session.prId);
      const comment = review?.comments.find(
        (c) => c.localId === action.localId,
      );
      if (!review || !comment)
        throw new Error("that staged comment is no longer in the draft");
      comment.body = action.body;
      await saveReview(review);
      break;
    }
  }

  const updated = await updateSessionById(sessionId, (s) => {
    const live = findAction(s, actionId);
    if (live) {
      live.state = "applied";
      live.error = undefined;
    }
  });
  return { session: updated, runId };
}

export async function rejectChatAction(
  sessionId: string,
  actionId: string,
): Promise<ChatSession> {
  return updateSessionById(sessionId, (s) => {
    const action = findAction(s, actionId);
    if (action) action.state = "rejected";
  });
}

/** Record why an apply failed, so the chip shows it instead of nothing. */
export async function markActionError(
  sessionId: string,
  actionId: string,
  message: string,
): Promise<void> {
  await updateSessionById(sessionId, (s) => {
    const action = findAction(s, actionId);
    if (action) action.error = message;
  }).catch(() => {});
}

function findAction(
  session: ChatSession,
  actionId: string,
): ChatAction | undefined {
  for (const message of session.messages) {
    const hit = message.actions?.find((a) => a.id === actionId);
    if (hit) return hit;
  }
  return undefined;
}

async function runForSession(session: ChatSession): Promise<AgentRun> {
  const run = await getRun(session.prId, session.headSha);
  if (!run) throw new Error("this PR has no agent run at this sha any more");
  if (run.status === "stale")
    throw new Error("new commits landed — rerun the agent first");
  return run;
}

/** The run that still owns `findingId` — findings live inside their run record. */
async function runOwning(
  session: ChatSession,
  findingId: string,
): Promise<AgentRun> {
  const run = await runForSession(session);
  // A rerun replaces the record for this sha, so ids from the answer can be
  // gone even though the conversation is still open.
  if (!run.findings.some((f) => f.id === findingId))
    throw new Error("that finding is gone — the agent was rerun since");
  return run;
}
