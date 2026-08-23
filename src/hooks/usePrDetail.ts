import { useQuery } from "@tanstack/react-query";
import { fetchPrDetail, fetchPrFiles } from "../api/prs";
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
