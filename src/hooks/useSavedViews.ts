import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@uipath/apollo-wind';
import { fetchViews, saveViews } from '../api/views';
import type { SavedView } from '../shared/review-types';

export function useSavedViews() {
  return useQuery({
    queryKey: ['views'],
    queryFn: fetchViews,
    staleTime: Infinity,
  });
}

export function useSaveViews() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (views: SavedView[]) => saveViews(views),
    onSuccess: (views) => {
      queryClient.setQueryData(['views'], views);
      // A changed query changes what the queue shows — refetch immediately.
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e) => {
      toast.error('Could not save views', { description: e instanceof Error ? e.message : undefined });
    },
  });
}
