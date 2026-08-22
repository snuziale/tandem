import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSeen, putSeen } from '../api/seen';
import type { PrId, PullRequest, SeenRecord } from '../shared/review-types';

export function useSeen() {
  return useQuery({ queryKey: ['seen'], queryFn: fetchSeen, staleTime: 30_000 });
}

/** True when the PR changed since the reviewer last opened it in Tandem
 * (or was never opened at all). */
export function hasUnseenChanges(seen: Record<string, SeenRecord> | undefined, pr: PullRequest): boolean {
  if (!seen) return false;
  const record = seen[pr.prId];
  if (!record) return true;
  return pr.updatedAt > record.updatedAt;
}

/** Mark a PR seen (called by the detail screen once it has loaded). */
export function useMarkSeen(prId: PrId, updatedAt: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!updatedAt) return;
    void putSeen(prId, updatedAt)
      .then(() => queryClient.invalidateQueries({ queryKey: ['seen'] }))
      .catch(() => {
        // best-effort marker — never surface an error for it
      });
  }, [prId, updatedAt, queryClient]);
}
