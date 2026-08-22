// Core review-domain wire types, shared by the Bun server (GitHub normalize,
// stores, routes) and the SPA client. The GitHub GraphQL/REST response shapes
// live in shared/gh/wire.ts; everything the app renders or persists uses these.

/** Canonical PR identity: `"owner/repo#123"`. Build/parse via shared/gh/prKey.ts. */
export type PrId = string;

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
export type CheckRollup = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NONE';
/** Diff side, GitHub's naming: LEFT = old file (deletions), RIGHT = new file (additions). */
export type DiffSide = 'LEFT' | 'RIGHT';
export type ReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export type CheckRun = {
  name: string;
  status: 'success' | 'failure' | 'pending' | 'neutral' | 'skipped';
  url?: string;
};

export type PullRequest = {
  prId: PrId;
  owner: string;
  repo: string;
  number: number;
  title: string;
  bodyMarkdown: string;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: ReviewDecision;
  checkRollup: CheckRollup;
  /** Individual check contexts (first 30). Present on queue and detail responses. */
  checkRuns: CheckRun[];
  threadCount: number;
  unresolvedThreadCount: number;
  updatedAt: string;
  url: string;
};

export type FileChangeStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export type FileChange = {
  path: string;
  previousPath?: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file. Absent for binaries and oversized files. */
  patch?: string;
  isBinary: boolean;
  isGenerated: boolean;
  /** Patch unavailable even via the raw-diff fallback — render "open on GitHub". */
  tooLarge?: boolean;
};

export type ReviewComment = {
  id: string;
  author: string;
  bodyMarkdown: string;
  createdAt: string;
};

/** An existing human review thread from GitHub, anchored to a diff line. */
export type ReviewThread = {
  id: string;
  path: string;
  /** Line on `side` the thread anchors to. Null when the thread is outdated
   * against the current diff (GitHub returns no line) — render un-anchored. */
  line: number | null;
  startLine?: number;
  side: DiffSide;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewComment[];
};

export type PrDetail = {
  pr: PullRequest;
  threads: ReviewThread[];
};

/** One comment staged in the local pending review. `localId` is client-minted
 * (crypto.randomUUID) so edits/removals address a stable row. */
export type PendingComment = {
  localId: string;
  /** Set when this comment was accepted from an agent finding — drives the
   * human/agent breakdown in the tray and finding-state transitions. */
  findingId?: string;
  path: string;
  line: number;
  startLine?: number;
  side: DiffSide;
  body: string;
  /** Exact replacement text for the anchored lines; submitted as a
   * ```suggestion fence appended to `body`. */
  suggestion?: string;
  /** The anchor line no longer exists in the current diff (set by the
   * staleness sweep after new commits). Blocks submit until re-anchored. */
  anchorMoved?: boolean;
};

/** The local pending review draft. Never exists on GitHub until submitted. */
export type PendingReview = {
  prId: PrId;
  headSha: string;
  comments: PendingComment[];
  verdict?: ReviewVerdict;
  summaryBody?: string;
  viewedFiles: string[];
  updatedAt: string;
};

export type SavedView = {
  id: string;
  name: string;
  /** Raw GitHub search query, always visible/editable in the query bar. */
  query: string;
  /** Whether PRs entering this view are pre-warmed by the agent. */
  agentEnabled: boolean;
  position: number;
};

export type RateLimitInfo = { remaining: number; limit: number; resetAt: string };

/** Response of POST /api/queue. */
export type QueueResult = {
  views: Record<string, PullRequest[]>;
  /** GitHub's issueCount per view — can exceed the fetched page of 50. */
  counts: Record<string, number>;
  /** Per-view failures (searches run independently); absent views succeeded. */
  errors: Record<string, string>;
  rateLimit: RateLimitInfo | null;
  fetchedAt: string;
};
