import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSeen, putSeen } from "../api/seen";
import type { PrId, PullRequest } from "../shared/review-types";

export function useSeen() {
  return useQuery({
    queryKey: ["seen"],
    queryFn: fetchSeen,
    staleTime: 30_000,
  });
}

/** Mark a PR seen (called by the detail screen once it has loaded).
 *
 * Depends on the SIGNAL's fields, not on the PR object: react-query hands back
 * a fresh object on every poll, so an identity dependency would re-PUT every
 * 30 seconds. */
export function useMarkSeen(prId: PrId, pr: PullRequest | undefined) {
  const queryClient = useQueryClient();
  const updatedAt = pr?.updatedAt;
  const headSha = pr?.headSha;
  const commentCount = pr?.commentCount;
  const threadCount = pr?.threadCount;
  useEffect(() => {
    if (updatedAt === undefined) return;
    void putSeen(prId, {
      updatedAt,
      headSha: headSha ?? "",
      commentCount: commentCount ?? 0,
      threadCount: threadCount ?? 0,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["seen"] }))
      .catch(() => {
        // best-effort marker — never surface an error for it
      });
  }, [prId, updatedAt, headSha, commentCount, threadCount, queryClient]);
}
