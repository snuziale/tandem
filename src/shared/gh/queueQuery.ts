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
  additions
  deletions
  changedFiles
  reviewDecision
  createdAt
  updatedAt
  reviewThreads(first: 1) { totalCount }
  commits(last: 1) {
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

export function buildQueueQuery(views: QueueQueryInput[], pageSize = 50): BuiltQueueQuery {
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
${searches.join('\n')}
}
${PR_SEARCH_FRAGMENT}`;
  return { gql, aliasToViewId };
}
