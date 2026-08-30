// The queue's per-check refinement, as a query.
//
// Two requests answer "what is the state of this PR's checks" because one
// cannot: the search that returns the rows can't carry check nodes without
// spending most of GitHub's ~10s budget (shared/gh/queueQuery.ts), while the
// same nodes fetched per PR are cheap (shared/gh/checksQuery.ts). So the table
// paints from the rollup and sharpens a couple of seconds later.
//
// It is keyed by the ROWS' identities — `prId@headSha` — so a new commit is a
// new question and an unchanged queue poll is a cache hit.
import { useQuery } from "@tanstack/react-query";
import { fetchQueueChecks } from "../api/queue";
import type { ChecksResult, PullRequest } from "../shared/review-types";

export function useQueueChecks(rows: PullRequest[] | undefined) {
  const key = (rows ?? []).map((pr) => `${pr.prId}@${pr.headSha}`).join(",");
  return useQuery<ChecksResult>({
    queryKey: ["queue", "checks", key],
    queryFn: ({ signal }) => fetchQueueChecks(rows ?? [], signal),
    enabled: key.length > 0,
    // The queue polls every 60s; refetching the checks on the same shas in
    // between would be a second request per poll for an unchanged answer.
    staleTime: 60_000,
    // Keep the previous refinement on screen while a new one loads — rows
    // flicking back to the coarse rollup and forward again reads as a bug.
    placeholderData: (prev) => prev,
  });
}
