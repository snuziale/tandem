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
  commits(last: 1) {
    totalCount
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 20) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
}`;

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
