import { useQuery } from "@tanstack/react-query";
import { fetchPrDetail, fetchPrFileAtRef, fetchPrFiles } from "../api/prs";
import type { PrId } from "../shared/review-types";

export function usePrDetail(prId: PrId) {
  return useQuery({
    queryKey: ["pr", prId],
    queryFn: ({ signal }) => fetchPrDetail(prId, signal),
  });
}

/** The file list is immutable per head sha — cache forever, no focus refetch. */
export function usePrFiles(prId: PrId, headSha: string | undefined) {
  return useQuery({
    queryKey: ["pr", "files", prId, headSha],
    queryFn: ({ signal }) => fetchPrFiles(prId, signal),
    enabled: !!headSha,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * One file's text at a commit — the diff pane's context expansion fetches this
 * imperatively (`queryClient.fetchQuery`) from a chevron click, so it needs the
 * options rather than a hook. Lives here so the whole `["pr", …]` key space has
 * one owner. A blob is immutable per commit; the cap is how long an unexpanded
 * file's text is worth keeping, not a staleness bound.
 */
export function prBlobQuery(prId: PrId, sha: string, path: string) {
  return {
    queryKey: ["pr", "blob", prId, sha, path] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchPrFileAtRef(prId, path, sha, signal),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  };
}
