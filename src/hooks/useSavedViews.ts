import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { fetchViews, saveViews } from "../api/views";
import { navigate } from "../routes";
import type { SavedView } from "../shared/review-types";

/** Mutation key of the saved-views write, observable via `useIsMutating`. */
export const SAVE_VIEWS_KEY = ["views", "save"] as const;

export function useSavedViews() {
  return useQuery({
    queryKey: ["views"],
    queryFn: fetchViews,
    staleTime: Infinity,
  });
}

export function useSaveViews() {
  const queryClient = useQueryClient();
  return useMutation({
    // Keyed so useActiveView can see a save in flight without threading the
    // mutation object through the component tree.
    mutationKey: SAVE_VIEWS_KEY,
    mutationFn: (views: SavedView[]) => saveViews(views),
    onSuccess: (views) => {
      queryClient.setQueryData(["views"], views);
      // A changed query changes what the queue shows — refetch immediately.
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => {
      toast.error("Could not save views", {
        description: e instanceof Error ? e.message : undefined,
      });
    },
  });
}

export type ViewActions = ReturnType<typeof useViewActions>;

/**
 * Every write to the saved-view list, with the navigation each one implies.
 * The server renumbers `position` from array order on save, so array order is
 * the truth and callers only ever splice this list.
 */
export function useViewActions(
  views: SavedView[] | undefined,
  activeViewId: string | null,
) {
  const save = useSaveViews();
  const list = views ?? [];
  const select = (id: string | null) => navigate({ name: "queue", viewId: id });

  return {
    select,
    replaceAll: (next: SavedView[]) => save.mutate(next),

    /** Create or update one view, then land on it. */
    upsert(view: SavedView) {
      const exists = list.some((v) => v.id === view.id);
      save.mutate(
        exists
          ? list.map((v) => (v.id === view.id ? view : v))
          : [...list, view],
      );
      select(view.id);
    },

    rename(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      save.mutate(list.map((v) => (v.id === id ? { ...v, name: trimmed } : v)));
    },

    /** Copy sits directly right of its source, and becomes the selected view. */
    duplicate(view: SavedView) {
      const copy: SavedView = {
        ...view,
        id: crypto.randomUUID(),
        name: `${view.name} copy`,
      };
      const at = list.findIndex((v) => v.id === view.id);
      const next = [...list];
      next.splice(at === -1 ? list.length : at + 1, 0, copy);
      save.mutate(next);
      select(copy.id);
    },

    /** Deleting the selected view slides onto its neighbour, never nowhere. */
    remove(id: string) {
      const at = list.findIndex((v) => v.id === id);
      const remaining = list.filter((v) => v.id !== id);
      save.mutate(remaining);
      if (activeViewId === id)
        select(
          (remaining[Math.min(at, remaining.length - 1)] ?? null)?.id ?? null,
        );
    },
  };
}
