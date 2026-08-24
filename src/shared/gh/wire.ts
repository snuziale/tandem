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
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl?: string | null;
    };

export type GqlCommitWithChecks = {
  commit: {
    oid: string;
    statusCheckRollup: {
      state: string;
      contexts: { nodes: GqlCheckContext[] };
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
};

export type GqlReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

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
