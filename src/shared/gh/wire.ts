// Raw GitHub GraphQL/REST response shapes, exactly as the API returns them.
// Only what Tandem reads — not a full API typing. Normalizers in
// shared/gh/normalize.ts map these onto the app's review-types.

// --- GraphQL: queue search + PR detail ---

export type GqlCheckContext =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl?: string | null;
      /** Fetched by the DETAIL query only — the queue asks for no nodes at
       * all. Together they answer "which of these same-named runs is the
       * latest", which is the whole basis of collapsing re-runs. */
      startedAt?: string | null;
      completedAt?: string | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl?: string | null;
      createdAt?: string | null;
    };

export type GqlCommitWithChecks = {
  commit: {
    oid: string;
    statusCheckRollup: {
      state: string;
      /** `totalCount` is what GitHub HAS and is always asked for; `nodes` is
       * the per-check breakdown and ONLY the detail query pays for it (see
       * queueQuery.ts for the measurement). A count taken from a windowed
       * `nodes` is a count of the window, never of the PR. */
      contexts: { totalCount?: number; nodes?: GqlCheckContext[] };
    } | null;
  };
};

export type GqlPrNode = {
  __typename?: string;
  number: number;
  title: string;
  url: string;
  /** Only fetched by the detail query; absent from the queue search. */
  body?: string;
  /** GitHub's own rendering, fetched alongside `body` by the detail query.
   * Read for ONE thing: it is the only place an attachment URL appears in a
   * form a browser can load (shared/gh/attachments.ts). */
  bodyHTML?: string;
  author: { login: string } | null;
  repository: { name: string; owner: { login: string } };
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  /** PullRequestState. Older cached responses may lack it — treated as OPEN. */
  state?: "OPEN" | "CLOSED" | "MERGED";
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** Absent on older cached responses — treated as "no review by me". */
  viewerLatestReview?: { state: GqlReviewState } | null;
  createdAt: string;
  updatedAt: string;
  reviewThreads: { totalCount: number; nodes?: GqlReviewThread[] };
  commits: { totalCount?: number; nodes: GqlCommitWithChecks[] };
  // --- Pulse inputs. Aliased totalCounts, not review nodes: the tally is all
  // the queue needs, and `reviews(states:)` under two aliases costs no nodes
  // at all. All optional — a cached response, or the detail query before it
  // was extended, simply reports zero rather than breaking normalization.
  approvals?: { totalCount: number };
  changesRequested?: { totalCount: number };
  comments?: { totalCount: number };
  autoMergeRequest?: { enabledBy?: { login: string } | null } | null;
  reviewRequests?: { totalCount: number; nodes?: GqlReviewRequest[] };
};

export type GqlReviewRequest = {
  requestedReviewer:
    | { __typename: "User"; login: string }
    | { __typename: "Team"; slug: string; organization?: { login: string } }
    | null;
};

export type GqlReviewState =
  "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export type GqlReviewThread = {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  isResolved: boolean;
  isOutdated: boolean;
  comments: {
    nodes: Array<{
      id: string;
      author: { login: string } | null;
      body: string;
      /** As on the PR node — attachments only. */
      bodyHTML?: string;
      createdAt: string;
    }>;
  };
};

export type GqlSearchResult = {
  issueCount: number;
  nodes: Array<GqlPrNode | null>;
};
export type GqlRateLimit = {
  remaining: number;
  limit: number;
  resetAt: string;
};

// --- REST: pull-request files ---

export type RestPullFile = {
  filename: string;
  previous_filename?: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  /** Omitted by GitHub for very large patches and for binary files. */
  patch?: string;
};
