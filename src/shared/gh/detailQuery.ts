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
      bodyHTML
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
      comments { totalCount }
      autoMergeRequest { enabledBy { login } }
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
              bodyHTML
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

// Everything a rendered body can reference, and nothing else. The attachment
// proxy resolves ONE uuid per request, so this runs on the image path and is
// kept deliberately lean — no checks, no diff, no thread metadata. See
// shared/gh/attachments.ts for why bodyHTML is the only place a loadable
// attachment URL exists.
export const PR_ATTACHMENTS_QUERY = `
query TandemPrAttachments($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      bodyHTML
      reviewThreads(first: 100) {
        nodes { comments(first: 30) { nodes { bodyHTML } } }
      }
    }
  }
}`;
