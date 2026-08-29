// Core review-domain wire types, shared by the Bun server (GitHub normalize,
// stores, routes) and the SPA client. The GitHub GraphQL/REST response shapes
// live in shared/gh/wire.ts; everything the app renders or persists uses these.

/** Canonical PR identity: `"owner/repo#123"`. Build/parse via shared/gh/prKey.ts. */
export type PrId = string;

export type ReviewDecision =
  "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
/** The VIEWER's own latest submitted review, verbatim from GitHub's
 * PullRequestReviewState. Distinct from reviewDecision: that one is the
 * repo-wide verdict and is null on any base branch without a required-reviews
 * rule — so an approval you posted yourself shows up here and NOWHERE else. */
export type ViewerReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING"
  | null;
/** GitHub's PullRequestState, verbatim. */
export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type CheckRollup = "SUCCESS" | "FAILURE" | "PENDING" | "NONE";
/** Diff side, GitHub's naming: LEFT = old file (deletions), RIGHT = new file (additions). */
export type DiffSide = "LEFT" | "RIGHT";
export type ReviewVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type CheckRun = {
  name: string;
  status: "success" | "failure" | "pending" | "neutral" | "skipped";
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
  state: PrState;
  /** Commits on the head branch, as GitHub counts them for the merge line. */
  commitCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: ReviewDecision;
  viewerReviewState: ViewerReviewState;
  checkRollup: CheckRollup;
  /** Individual check contexts (first 30). Present on queue and detail responses. */
  checkRuns: CheckRun[];
  threadCount: number;
  unresolvedThreadCount: number;
  /** Submitted APPROVED reviews. Counted, not listed — the queue only needs
   * the tally, and `reviews(states:)` totalCount costs no nodes. */
  approvalCount: number;
  /** Submitted CHANGES_REQUESTED reviews — the strongest "ball is with the
   * author" signal there is. */
  changesRequestedCount: number;
  /** Issue-level comments (not review threads); `threadCount` is the other half. */
  commentCount: number;
  /** Login that armed auto-merge, or null. A PR that merges itself the moment
   * checks go green is not waiting on anyone. */
  autoMergeBy: string | null;
  /** Outstanding review requests: user logins, and teams as "org/slug".
   * Team membership is not resolvable here, so a team request never counts as
   * a request from YOU. */
  requestedReviewers: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
};

/** What a PR looked like when the reviewer last opened it in Tandem — the
 * queue's "unseen changes" marker is this compared against the PR today.
 *
 * `updatedAt` was once the WHOLE record, and GitHub moves it for label,
 * assignee, milestone and title churn as readily as for a push — so the dot
 * mostly meant "a bot touched this". The head sha and the two conversation
 * counts are the half that means there is something new to READ. The three
 * are optional because records written before that widening are still on
 * disk and must keep answering. */
export type SeenRecord = {
  prId: PrId;
  updatedAt: string;
  seenAt: string;
  headSha?: string;
  commentCount?: number;
  threadCount?: number;
};

/** The part of a PR that decides whether it changed. Written by the detail
 * screen, read back by the queue — the two must name the same quantities,
 * which is why this is one type rather than a PUT body spelled twice. */
export type SeenSignal = {
  updatedAt: string;
  headSha: string;
  /** Issue-level comments. `reviewThreads.totalCount` is the other half, and
   * both are asked for by the queue fragment AND the detail query. */
  commentCount: number;
  threadCount: number;
};

export function seenSignalOf(pr: PullRequest): SeenSignal {
  return {
    updatedAt: pr.updatedAt,
    headSha: pr.headSha,
    commentCount: pr.commentCount,
    threadCount: pr.threadCount,
  };
}

/** True when the PR changed in a way worth re-opening it for, or was never
 * opened at all. */
export function hasUnseenChanges(
  seen: Record<string, SeenRecord> | undefined,
  pr: PullRequest,
): boolean {
  if (!seen) return false;
  const record = seen[pr.prId];
  if (!record) return true;
  // A record from before the widening (or one whose search returned no
  // commit) knows a timestamp and nothing else — answer with what it has
  // rather than silently going quiet on a PR that really did move.
  if (!record.headSha) return pr.updatedAt > record.updatedAt;
  // An empty sha on the PR claims nothing either: absent is not "moved".
  if (pr.headSha && pr.headSha !== record.headSha) return true;
  // Counts must GROW. A deleted comment left nothing new to read.
  return (
    pr.commentCount > (record.commentCount ?? 0) ||
    pr.threadCount > (record.threadCount ?? 0)
  );
}

export type FileChangeStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

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
  /** The agent drafted this text in CHAT, with no finding behind it
   * (`stage-comment`). Without it such a comment has no `findingId` and so
   * reads as the reviewer's own — see `isAgentAuthored`. */
  agentDrafted?: boolean;
};

/**
 * Did the agent write this comment's text?
 *
 * Two ways it can be true — accepted from a finding (`findingId`), or drafted
 * in chat (`agentDrafted`) — and every surface that marks provenance has to
 * agree on both, because violet means machine-authored (invariant §3) and a
 * chat-drafted comment labelled "your comment" is that claim being made wrong.
 */
export function isAgentAuthored(comment: PendingComment): boolean {
  return comment.findingId !== undefined || comment.agentDrafted === true;
}

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
  /** Raw GitHub search query, always visible/editable in the query bar. May
   * contain the `{team}` token (see shared/gh/team.ts), which the server
   * expands before searching. */
  query: string;
  /** Whether PRs entering this view are pre-warmed by the agent. */
  agentEnabled: boolean;
  /** Team backing this view's `{team}` token. A view without one ignores it. */
  teamId?: string;
  position: number;
};

export type RateLimitInfo = {
  remaining: number;
  limit: number;
  resetAt: string;
};

/** Response of POST /api/queue. */
export type QueueResult = {
  views: Record<string, PullRequest[]>;
  /** GitHub's issueCount per view — can exceed the fetched page of 50. */
  counts: Record<string, number>;
  /** Per-view failures (searches run independently); absent views succeeded. */
  errors: Record<string, string>;
  /**
   * How many parallel searches each view fanned out to. 1 for a plain view;
   * more when a team was sharded (shared/gh/team.ts). Surfaced so "this
   * view costs 6 searches a poll" is visible rather than inferred.
   */
  shards: Record<string, number>;
  rateLimit: RateLimitInfo | null;
  fetchedAt: string;
};
