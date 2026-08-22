import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@uipath/apollo-wind';
import { fetchReview, putReview } from '../api/reviews';
import type { PendingComment, PendingReview, PrId } from '../shared/review-types';

export function emptyReview(prId: PrId, headSha: string): PendingReview {
  return { prId, headSha, comments: [], viewedFiles: [], updatedAt: '' };
}

/** The local pending-review draft: server-persisted, optimistically updated.
 * Callers mutate through `update(next)` with a complete PendingReview. */
export function usePendingReview(prId: PrId, headSha: string | undefined) {
  const queryClient = useQueryClient();
  const key = ['review', prId];

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchReview(prId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: putReview,
    onMutate: async (next: PendingReview) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PendingReview | null>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (e, _next, ctx) => {
      queryClient.setQueryData(key, ctx?.prev ?? null);
      toast.error('Draft could not be saved', { description: e instanceof Error ? e.message : undefined });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const review = query.data ?? (headSha ? emptyReview(prId, headSha) : null);

  const toggleViewed = (path: string) => {
    if (!review) return;
    const viewedFiles = review.viewedFiles.includes(path)
      ? review.viewedFiles.filter((p) => p !== path)
      : [...review.viewedFiles, path];
    mutation.mutate({ ...review, viewedFiles });
  };

  const addComment = (comment: Omit<PendingComment, 'localId'>) => {
    if (!review) return;
    mutation.mutate({ ...review, comments: [...review.comments, { ...comment, localId: crypto.randomUUID() }] });
  };

  const updateComment = (localId: string, patch: Partial<PendingComment>) => {
    if (!review) return;
    mutation.mutate({
      ...review,
      comments: review.comments.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    });
  };

  const removeComment = (localId: string) => {
    if (!review) return;
    mutation.mutate({ ...review, comments: review.comments.filter((c) => c.localId !== localId) });
  };

  const setVerdict = (verdict: PendingReview['verdict']) => {
    if (!review) return;
    mutation.mutate({ ...review, verdict });
  };

  const setSummary = (summaryBody: string) => {
    if (!review) return;
    mutation.mutate({ ...review, summaryBody });
  };

  return {
    review,
    isLoading: query.isPending,
    update: mutation.mutate,
    toggleViewed,
    addComment,
    updateComment,
    removeComment,
    setVerdict,
    setSummary,
  };
}
