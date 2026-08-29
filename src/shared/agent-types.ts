// Agent-domain wire types: runs, findings, and the SSE stream shape. Shared by
// the Bun server (pipeline, run store, routes) and the SPA client (agent pane,
// queue agent cell). State machines are enforced server-side via the edge
// tables at the bottom — the client only ever requests transitions.
import type { DiffSide, PrId } from "./review-types";

export type Severity = "blocker" | "risk" | "nit" | "question" | "praise";
export type Category =
  | "correctness"
  | "security"
  | "performance"
  | "api-contract"
  | "test-gap"
  | "style"
  | "docs";

export const SEVERITIES: readonly Severity[] = [
  "blocker",
  "risk",
  "nit",
  "question",
  "praise",
];
/**
 * Findings still in TRIAGE — the ones a reviewer can act on.
 *
 * `proposed || edited` was spelled out at four call sites (the pane, the
 * status strip, the activity reconciler and the openers) before this existed;
 * it is the definition of "open", so it belongs beside the state machine it
 * reads rather than in whichever component needed it first.
 */
export function openFindings(run: { findings: Finding[] } | undefined | null) {
  if (!run) return [];
  return run.findings.filter(
    (f) => f.state === "proposed" || f.state === "edited",
  );
}

export const CATEGORIES: readonly Category[] = [
  "correctness",
  "security",
  "performance",
  "api-contract",
  "test-gap",
  "style",
  "docs",
];

export type FindingState =
  "proposed" | "staged" | "edited" | "dismissed" | "posted" | "stale";

export type Evidence = {
  path: string;
  /** Line range the agent actually read, e.g. "43-45". */
  lines: string;
  why: string;
};

export type Finding = {
  id: string;
  runId: string;
  prId: PrId;
  headSha: string;
  path: string;
  side: DiffSide;
  startLine?: number;
  endLine: number;
  severity: Severity;
  category: Category;
  /** One line, imperative or declarative, no hedging. */
  title: string;
  /** Markdown, 1–3 sentences. */
  body: string;
  /** Exact replacement text for lines startLine..endLine. */
  suggestion?: string;
  confidence: number;
  evidence: Evidence[];
  state: FindingState;
};

export type AgentRunStatus =
  | "queued"
  | "fetching"
  | "analyzing"
  | "ready"
  | "failed"
  | "skipped"
  | "stale";

export type SkipReason =
  | "draft"
  | "too-many-files"
  | "diff-too-large"
  | "generated-only"
  | "budget"
  | "agent-disabled";

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  draft: "draft",
  "too-many-files": "over file cap",
  "diff-too-large": "diff too large",
  "generated-only": "generated files only",
  budget: "daily budget spent",
  "agent-disabled": "agent off for repo",
};

export type RunStepStatus = "running" | "done" | "failed";

/**
 * One observable stage of a run: the file fetch, then one entry per model
 * pass (pass 2 contributes one per cluster). Persisted ON the run rather than
 * left in the SSE replay buffer, which live.ts drops the moment the run ends —
 * without that, "what did it actually do?" dies with the stream and a failed
 * run is a bare message with no trace of which pass died.
 */
export type RunStep = {
  /** Stable within the run; the client upserts by it.
   * "fetch" | "orient" | "analyze:<i>" | "reconcile". */
  id: string;
  /** Pipeline pass this belongs to; absent for the pre-model fetch. */
  pass?: 1 | 2 | 3;
  label: string;
  /** The cluster's files, for a pass-2 step — what the agent is reading NOW. */
  paths?: string[];
  status: RunStepStatus;
  startedAt: string;
  finishedAt?: string;
  /** Short note: degraded orient, unusable cluster, candidate count. */
  detail?: string;
};

export type AgentRun = {
  id: string;
  prId: PrId;
  headSha: string;
  status: AgentRunStatus;
  /** Which configured agent profile produced this run. */
  agentId?: string;
  agentName?: string;
  /** Pass-1 review plan: what the agent set out to check. */
  plan?: string[];
  /** Ordered timeline of the run's stages (see RunStep). */
  steps?: RunStep[];
  /** Prose summary of what the agent read and concluded (pass 3 output). */
  summary?: string;
  /** Pass-3 merge-readiness score, 0-100. */
  score?: number;
  /** This run met the opt-in auto-approve gate and an APPROVE was posted. */
  autoApproved?: boolean;
  findings: Finding[];
  startedAt?: string;
  finishedAt?: string;
  tokensUsed: number;
  costUsd: number;
  error?: string;
  skipReason?: SkipReason;
};

/**
 * One unit of agent work in flight RIGHT NOW, derived from the server's live
 * registry (server/agent/live.ts) for the header's status strip and tray.
 *
 * Runs AND chat turns both appear, told apart by `kind` exactly as live.ts
 * tells them apart — a streaming chat turn is real work the user is waiting
 * on, and until this existed it was completely invisible outside the pane it
 * was streaming into. `kind` is also what keeps it out of the run accounting.
 *
 * Everything here is derived from events the passes ALREADY emit; nothing new
 * is published to produce it, so a run that says nothing on the wire also says
 * nothing here rather than inventing progress.
 */
export type LiveWork = {
  /** runId for a run, chat session id for a turn. */
  id: string;
  kind: "run" | "chat";
  prId: PrId;
  /** The sha under analysis — joins back to the full AgentRun by runKeyOf. */
  headSha?: string;
  agentName?: string;
  /** Pipeline pass the run has reached; absent before pass 1, and for chat. */
  pass?: 1 | 2 | 3;
  /** What it is doing right now: the running step's label, or the chat status. */
  label: string;
  /** Files the current step is reading — "it is reading MY code", not "busy". */
  paths?: string[];
  startedAt: string;
  tokensUsed: number;
  costUsd: number;
};

/**
 * SSE frames on /api/runs/:id/stream. Structural progress, not a token stream:
 * the pipeline passes each emit one strict-JSON blob, so there is no prose to
 * stream — everything worth watching is derivable from the steps.
 */
export type RunEvent =
  | { type: "status"; status: AgentRunStatus; detail?: string }
  | { type: "plan"; checks: string[]; degraded?: boolean }
  | { type: "step"; step: RunStep }
  | { type: "usage"; tokens: number; costUsd: number }
  | { type: "done"; run: AgentRun }
  | { type: "error"; message: string };

/** Statuses that mean the pipeline has not finished with this run. */
export function isActiveRun(run: Pick<AgentRun, "status">): boolean {
  return (
    run.status === "queued" ||
    run.status === "fetching" ||
    run.status === "analyzing"
  );
}

/**
 * A run left in an active status by a process that is gone. Age-gated on
 * purpose: TWO servers can share `$TANDEM_HOME` (the native app on 5274 and a
 * dev server next to it), and one must never declare the other's genuinely
 * live run dead. Nothing legitimate outlives this window — a pass is capped at
 * 10 minutes and a run is a handful of passes.
 *
 * Shared, not server-only, because the same question decides two things: which
 * runs the startup sweep fails, and which active-but-unstreamed runs the status
 * strip is willing to call in flight. One window, one answer.
 */
export const INTERRUPTED_AFTER_MS = 45 * 60_000;

export function isInterrupted(
  run: Pick<AgentRun, "status" | "startedAt">,
  now: number,
  maxAgeMs: number = INTERRUPTED_AFTER_MS,
): boolean {
  if (!isActiveRun(run)) return false;
  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  // No usable timestamp: it cannot be young, so treat it as interrupted.
  if (Number.isNaN(started)) return true;
  return now - started > maxAgeMs;
}

// ---------------------------------------------------------------------------
// State machines (spec §2). Enforced by the server stores: transitionRun /
// transitionFinding throw on any edge not listed here. `stale` is reachable
// from anywhere via the staleness sweep when headSha changes.

export const RUN_EDGES: Readonly<
  Record<AgentRunStatus, readonly AgentRunStatus[]>
> = {
  // `failed` from queued: the process that owned the run died before it got
  // going (see reconcileInterruptedRuns).
  queued: ["fetching", "failed", "skipped", "stale"],
  fetching: ["analyzing", "failed", "stale"],
  analyzing: ["ready", "failed", "stale"],
  ready: ["stale"],
  failed: ["queued", "stale"],
  skipped: ["queued", "stale"],
  stale: ["queued"],
};

export const FINDING_EDGES: Readonly<
  Record<FindingState, readonly FindingState[]>
> = {
  proposed: ["staged", "edited", "dismissed", "stale"],
  edited: ["staged", "dismissed", "stale"],
  staged: ["posted", "proposed", "edited", "dismissed", "stale"],
  dismissed: ["proposed", "stale"],
  posted: [],
  stale: [],
};

export function canTransitionRun(
  from: AgentRunStatus,
  to: AgentRunStatus,
): boolean {
  return RUN_EDGES[from].includes(to);
}

export function canTransitionFinding(
  from: FindingState,
  to: FindingState,
): boolean {
  return FINDING_EDGES[from].includes(to);
}
