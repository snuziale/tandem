// Chat-domain wire types: the reviewer's conversation with the agent about a
// PR or one finding, and the ACTIONS a turn can propose. Shared by the Bun
// server (chat store, turn, routes) and the SPA client (ChatPanel).
//
// Invariant §1 holds here unchanged: a chat turn is a read-only claude pass,
// and every action it proposes is inert until the human clicks Apply. Nothing
// in this file can reach GitHub — submit.ts is still the only writer.
import type { FindingJson } from "./finding-schema";
import type { Severity } from "./agent-types";
import type { PrId } from "./review-types";

/** What a conversation is about: a PR at a sha, optionally narrowed to one finding. */
export type ChatScope = { prId: PrId; headSha: string; findingId?: string };

/** Session identity — also the storage key and the URL segment. A new head sha
 * or a different finding is a DIFFERENT conversation, so scope is the key. */
export function chatKeyOf(
  prId: PrId,
  headSha: string,
  findingId?: string,
): string {
  return `${prId}@${headSha}${findingId ? `#${findingId}` : ""}`;
}

export type ChatActionState = "proposed" | "applied" | "rejected";

type ActionBase = {
  id: string;
  state: ChatActionState;
  /** One line: why the agent is proposing this. Shown on the chip. */
  why: string;
  /** Set when the apply attempt failed — shown instead of a silent no-op. */
  error?: string;
};

/** Rewrite a finding still in triage (proposed/edited). A finding you already
 * staged is revised through `revise-comment` instead — the draft owns the text. */
export type ReviseFindingAction = ActionBase & {
  kind: "revise-finding";
  findingId: string;
  title?: string;
  body?: string;
  severity?: Severity;
  /** New replacement text, or null to drop the existing suggestion. */
  suggestion?: string | null;
};

export type DismissFindingAction = ActionBase & {
  kind: "dismiss-finding";
  findingId: string;
};

/** A finding the conversation surfaced that the run never emitted. Anchored and
 * schema-checked exactly like a pass-2 candidate before it is ever offered. */
export type NewFindingAction = ActionBase & {
  kind: "new-finding";
  finding: FindingJson;
};

/** Rewrite the body of a comment already staged in the pending review. */
export type ReviseCommentAction = ActionBase & {
  kind: "revise-comment";
  localId: string;
  body: string;
};

export type ChatAction =
  | ReviseFindingAction
  | DismissFindingAction
  | NewFindingAction
  | ReviseCommentAction;

export type ChatRole = "user" | "agent";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  /** Markdown prose. For agent turns this is the reply with the action fence stripped. */
  text: string;
  createdAt: string;
  /** Agent turns only. */
  agentId?: string;
  agentName?: string;
  actions?: ChatAction[];
  /** Files the server fetched for this turn because the agent asked for them. */
  contextRead?: string[];
  tokens?: number;
  costUsd?: number;
  /** The turn failed; `text` carries whatever prose arrived before it did. */
  error?: string;
};

export type ChatSessionStatus = "idle" | "thinking";

export type ChatSession = {
  /** chatKeyOf(prId, headSha, findingId). */
  id: string;
  prId: PrId;
  headSha: string;
  findingId?: string;
  status: ChatSessionStatus;
  messages: ChatMessage[];
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

/** SSE frames on /api/chats/:id/stream. `delta` is real token text (the CLI's
 * partial-message frames); `turn-end` is always last, error or not. */
export type ChatEvent =
  | { type: "status"; label: string }
  | { type: "delta"; text: string }
  | { type: "context"; paths: string[] }
  | { type: "turn-end"; session: ChatSession }
  | { type: "error"; message: string };

export function newChatSession(scope: ChatScope): ChatSession {
  const now = new Date().toISOString();
  return {
    id: chatKeyOf(scope.prId, scope.headSha, scope.findingId),
    prId: scope.prId,
    headSha: scope.headSha,
    findingId: scope.findingId,
    status: "idle",
    messages: [],
    tokensUsed: 0,
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
}
