import { useQuery } from '@tanstack/react-query';
import { fetchQueue } from '../api/queue';
import type { SavedView } from '../shared/review-types';

/** One request for all views (batched aliased GraphQL server-side), polled at
 * 60s and refetched on window focus (spec §3.1). */
export function useQueue(views: SavedView[] | undefined) {
  const inputs = (views ?? []).map((v) => ({ id: v.id, query: v.query, agentEnabled: v.agentEnabled }));
  return useQuery({
    queryKey: ['queue', inputs],
    queryFn: ({ signal }) => fetchQueue(views ?? [], signal),
    enabled: inputs.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
