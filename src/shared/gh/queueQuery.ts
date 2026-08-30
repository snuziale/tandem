// Builds the single aliased GraphQL request that powers the queue: one
// `search()` per saved view, batched into one round trip, plus the rateLimit
// budget. Raw view queries are user-authored — they are embedded as JSON
// string literals, never interpolated bare.

export const PR_SEARCH_FRAGMENT = `
fragment PrFields on PullRequest {
  __typename
  number
  title
  url
  author { login }
  repository { name owner { login } }
  headRefName
  baseRefName
  isDraft
  state
  additions
  deletions
  changedFiles
  reviewDecision
  viewerLatestReview { state }
  createdAt
  updatedAt
  reviewThreads(first: 1) { totalCount }
  comments { totalCount }
  autoMergeRequest { enabledBy { login } }
  # Two aliases of the same field with different args — the ONLY way to ask
  # for both tallies in one selection set (the same key twice is a conflict,
  # which is why detailQuery.ts can't reuse this fragment for threads).
  approvals: reviews(states: [APPROVED]) { totalCount }
  changesRequested: reviews(states: [CHANGES_REQUESTED]) { totalCount }
  reviewRequests(first: 10) {
    totalCount
    nodes {
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { slug organization { login } }
      }
    }
  }
  commits(last: 1) {
    totalCount
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts { totalCount }
        }
      }
    }
  }
}`;

// MEASURED 2026-08-29 against `repo:UiPath/flow-workbench` (50 rows, a repo
// whose PRs carry 53 check contexts), three runs each:
//   contexts(first: 20) + nodes   2.6-3.7s   202KB
//   contexts(first: 100) + nodes  7.9-8.1s   489KB
//   contexts { totalCount }       1.3-1.4s     8KB
// The check-context NODES were half the queue's latency on this view — the
// note that trimming node fields "doesn't buy it back" was measured against a
// repo with a handful of checks and does not hold here. They also could not
// be used honestly: 20 of 53 is a window, and every count the column drew from
// it was a count of the window (see shared/checks.ts). So the queue asks for
// the ROLLUP and the TOTAL, which are exact, and the per-check breakdown is
// the PR detail query's job — one PR, ~0.75s, no window needed.

export type QueueQueryInput = { id: string; query: string };

export type BuiltQueueQuery = {
  gql: string;
  /** GraphQL alias (`v0`, `v1`, …) → view id, for unpacking the response. */
  aliasToViewId: Record<string, string>;
};

export function buildQueueQuery(
  views: QueueQueryInput[],
  // MEASURED, not chosen: a 518-match `review-requested:@me` search already
  // runs 6.5-6.8s at 50 against GitHub's ~10s GraphQL budget, and 504s/502s
  // start at 60. Trimming the node fields doesn't buy it back — the same
  // search with no check contexts and no threads still took 7.5-9.3s at 100,
  // so the cost is the search, not the payload. Raising this makes the queue
  // flaky; the stats drawer says out loud when a view is bigger than one page.
  pageSize = 50,
): BuiltQueueQuery {
  const aliasToViewId: Record<string, string> = {};
  const searches = views.map((view, i) => {
    const alias = `v${i}`;
    aliasToViewId[alias] = view.id;
    return `  ${alias}: search(type: ISSUE, first: ${pageSize}, query: ${JSON.stringify(view.query)}) {
    issueCount
    nodes { ...PrFields }
  }`;
  });
  const gql = `query TandemQueue {
  rateLimit { remaining limit resetAt }
${searches.join("\n")}
}
${PR_SEARCH_FRAGMENT}`;
  return { gql, aliasToViewId };
}
