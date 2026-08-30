// The queue's SECOND checks request — the one that lets a queue row say what
// the PR page says.
//
// The queue search itself cannot carry per-check nodes: asking for them inside
// a `search` costs 4-5 seconds (MEASURED 2026-08-29 — see queueQuery.ts), which
// is most of GitHub's ~10s budget. But the same nodes fetched through
// `repository.pullRequest` are CHEAP: 25 PRs with their full context list came
// back in 2.4s, 10 in 1.2s. The cost was never the check runs, it was
// materializing them across a search result set.
//
// So the queue paints from the rollup immediately and this refines it after,
// in parallel chunks — the same shape the queue already uses for views.
import type { PrId } from "../review-types";

/**
 * PRs per aliased request. MEASURED on `repo:UiPath/flow-workbench` (20-86
 * contexts per PR): 10 → 1.2s, 25 → 2.4s. 25 keeps a full 50-row queue at two
 * parallel requests, both comfortably inside the budget that kills a search.
 */
export const CHECKS_CHUNK = 25;

/** Ceiling on chunks per refresh, so a big queue can't fan out without limit. */
export const MAX_CHECKS_CHUNKS = 4;

export type ChecksRef = {
  prId: PrId;
  owner: string;
  repo: string;
  number: number;
};

export type BuiltChecksQuery = {
  gql: string;
  /** GraphQL alias (`p0`, `p1`, …) → prId, for unpacking the response. */
  aliasToPrId: Record<string, PrId>;
};

export function chunkChecksRefs(
  refs: readonly ChecksRef[],
  size = CHECKS_CHUNK,
  maxChunks = MAX_CHECKS_CHUNKS,
): ChecksRef[][] {
  const chunks: ChecksRef[][] = [];
  for (let i = 0; i < refs.length && chunks.length < maxChunks; i += size)
    chunks.push(refs.slice(i, i + size));
  return chunks;
}

/**
 * One aliased `repository.pullRequest` per PR, each asking for the head
 * commit's rollup AND its contexts.
 *
 * `first: 100` is the window, and it is generous on purpose: a PR over it
 * comes back `partial`, and shared/checks.ts then refuses to collapse re-runs
 * rather than collapsing against a list that may be missing the newest
 * attempt. `completedAt`/`startedAt` are what "latest attempt" is decided on.
 */
export function buildChecksQuery(refs: readonly ChecksRef[]): BuiltChecksQuery {
  const aliasToPrId: Record<string, PrId> = {};
  const parts = refs.map((ref, i) => {
    const alias = `p${i}`;
    aliasToPrId[alias] = ref.prId;
    return `  ${alias}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
    pullRequest(number: ${ref.number}) { ...PrChecks }
  }`;
  });
  return {
    gql: `query TandemQueueChecks {
${parts.join("\n")}
}

fragment PrChecks on PullRequest {
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                detailsUrl
                startedAt
                completedAt
              }
              ... on StatusContext { context state targetUrl createdAt }
            }
          }
        }
      }
    }
  }
}`,
    aliasToPrId,
  };
}
