// The PR-detail GraphQL query. Deliberately NOT built from PR_SEARCH_FRAGMENT:
// the queue fragment requests reviewThreads(first: 1) { totalCount } and this
// query needs reviewThreads(first: 100) with nodes — the same field with
// different arguments in one selection set is a GraphQL conflict.
export const PR_DETAIL_QUERY = `
query TandemPrDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      __typename
      number
      title
      url
      body
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
      createdAt
      updatedAt
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          path
          line
          startLine
          diffSide
          isResolved
          isOutdated
          comments(first: 30) {
            nodes {
              id
              author { login }
              body
              createdAt
            }
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
              contexts(first: 30) {
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
    }
  }
}`;
