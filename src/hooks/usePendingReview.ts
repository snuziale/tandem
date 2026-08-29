import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { fetchReview, putReview } from "../api/reviews";
import type {
  PendingComment,
  PendingReview,
  PrId,
} from "../shared/review-types";

/** Equal for everything the UI draws — `updatedAt` is the server's write
 * stamp and is never rendered. */
function sameDraft(a: PendingReview, b: PendingReview): boolean {
  return (
    a.headSha === b.headSha &&
    a.verdict === b.verdict &&
    a.summaryBody === b.summaryBody &&
    JSON.stringify(a.viewedFiles) === JSON.stringify(b.viewedFiles) &&
    JSON.stringify(a.comments) === JSON.stringify(b.comments)
  );
}

export function emptyReview(prId: PrId, headSha: string): PendingReview {
  return { prId, headSha, comments: [], viewedFiles: [], updatedAt: "" };
}

/** The local pending-review draft: server-persisted, optimistically updated.
 * Callers mutate through `update(next)` with a complete PendingReview. */
export function usePendingReview(prId: PrId, headSha: string | undefined) {
  const queryClient = useQueryClient();
  const key = ["review", prId];

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchReview(prId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Every write is one mutation on this key, which is how the last one in
  // flight is told apart below.
  const mutationKey = ["review", prId, "save"];

  const mutation = useMutation({
    mutationKey,
    mutationFn: putReview,
    onMutate: async (next: PendingReview) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PendingReview | null>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (e, _next, ctx) => {
      // Roll back, then resync: after a failed write the server is the only
      // thing that knows what the draft actually is.
      queryClient.setQueryData(key, ctx?.prev ?? null);
      void queryClient.invalidateQueries({ queryKey: key });
      toast.error("Draft could not be saved", {
        description: e instanceof Error ? e.message : undefined,
      });
    },
    // The PUT ANSWERS with the stored draft, so a success is reconciled from
    // the response instead of invalidated. An invalidate here cost a second
    // GET and a second render for every viewed toggle and every staged
    // comment — and on the PR screen a render means rebuilding the diff pane's
    // whole `items` array and pushing a `setItems` through CodeView, which is
    // O(files).
    //
    // Two guards. Only the LAST mutation in flight writes, or a slow response
    // would stomp a newer optimistic state (holding `v` outruns the round
    // trip); query-core dispatches `success` AFTER this runs, so `isMutating`
    // still counts this one. And the echo is only written when it actually
    // differs: the server stamps a fresh `updatedAt` on every write, so
    // publishing it unconditionally would hand every subscriber a new object —
    // a second `items` rebuild per toggle, for a field nothing renders.
    onSuccess: (saved) => {
      if (queryClient.isMutating({ mutationKey }) !== 1) return;
      const current = queryClient.getQueryData<PendingReview | null>(key);
      if (current && sameDraft(current, saved)) return;
      queryClient.setQueryData(key, saved);
    },
  });

  const review = query.data ?? (headSha ? emptyReview(prId, headSha) : null);

  const toggleViewed = (path: string) => {
    if (!review) return;
    const viewedFiles = review.viewedFiles.includes(path)
      ? review.viewedFiles.filter((p) => p !== path)
      : [...review.viewedFiles, path];
    mutation.mutate({ ...review, viewedFiles });
  };

  const addComment = (comment: Omit<PendingComment, "localId">) => {
    if (!review) return;
    mutation.mutate({
      ...review,
      comments: [
        ...review.comments,
        { ...comment, localId: crypto.randomUUID() },
      ],
    });
  };

  const updateComment = (localId: string, patch: Partial<PendingComment>) => {
    if (!review) return;
    mutation.mutate({
      ...review,
      comments: review.comments.map((c) =>
        c.localId === localId ? { ...c, ...patch } : c,
      ),
    });
  };

  const removeComment = (localId: string) => {
    if (!review) return;
    mutation.mutate({
      ...review,
      comments: review.comments.filter((c) => c.localId !== localId),
    });
  };

  const setVerdict = (verdict: PendingReview["verdict"]) => {
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
