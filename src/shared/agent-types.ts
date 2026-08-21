// Agent-domain wire types: runs, findings, and the SSE stream shape. Shared by
// the Bun server (pipeline, run store, routes) and the SPA client (agent pane,
// queue agent cell). State machines are enforced server-side via the edge
// tables at the bottom — the client only ever requests transitions.
import type { DiffSide, PrId } from './review-types';

export type Severity = 'blocker' | 'risk' | 'nit' | 'question' | 'praise';
export type Category = 'correctness' | 'security' | 'performance' | 'api-contract' | 'test-gap' | 'style' | 'docs';

export const SEVERITIES: readonly Severity[] = ['blocker', 'risk', 'nit', 'question', 'praise'];
export const CATEGORIES: readonly Category[] = ['correctness', 'security', 'performance', 'api-contract', 'test-gap', 'style', 'docs'];

export type FindingState = 'proposed' | 'staged' | 'edited' | 'dismissed' | 'posted' | 'stale';

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

export type AgentRunStatus = 'queued' | 'fetching' | 'analyzing' | 'ready' | 'failed' | 'skipped' | 'stale';

export type SkipReason = 'draft' | 'too-many-files' | 'diff-too-large' | 'generated-only' | 'budget' | 'agent-disabled';

export type AgentRun = {
  id: string;
  prId: PrId;
  headSha: string;
  status: AgentRunStatus;
  /** Prose summary of what the agent read and concluded (pass 3 output). */
  summary?: string;
  findings: Finding[];
  startedAt?: string;
  finishedAt?: string;
  tokensUsed: number;
  costUsd: number;
  error?: string;
  skipReason?: SkipReason;
};

/** SSE frames on /api/runs/:id/stream. Coarse pass progress, not a token stream. */
export type RunEvent =
  | { type: 'status'; status: AgentRunStatus; detail?: string }
  | { type: 'pass'; pass: 1 | 2 | 3; label: string }
  | { type: 'usage'; tokens: number; costUsd: number }
  | { type: 'done'; run: AgentRun }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// State machines (spec §2). Enforced by the server stores: transitionRun /
// transitionFinding throw on any edge not listed here. `stale` is reachable
// from anywhere via the staleness sweep when headSha changes.

export const RUN_EDGES: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ['fetching', 'skipped', 'stale'],
  fetching: ['analyzing', 'failed', 'stale'],
  analyzing: ['ready', 'failed', 'stale'],
  ready: ['stale'],
  failed: ['queued', 'stale'],
  skipped: ['queued', 'stale'],
  stale: ['queued'],
};

export const FINDING_EDGES: Readonly<Record<FindingState, readonly FindingState[]>> = {
  proposed: ['staged', 'edited', 'dismissed', 'stale'],
  edited: ['staged', 'dismissed', 'stale'],
  staged: ['posted', 'proposed', 'edited', 'dismissed', 'stale'],
  dismissed: ['proposed', 'stale'],
  posted: [],
  stale: [],
};

export function canTransitionRun(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return RUN_EDGES[from].includes(to);
}

export function canTransitionFinding(from: FindingState, to: FindingState): boolean {
  return FINDING_EDGES[from].includes(to);
}
