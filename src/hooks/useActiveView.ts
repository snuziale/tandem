// The queue's selected view is URL state (`/?view=<id>`), so tab switches are
// real navigations. This hook is the single place the URL and the saved-view
// list are reconciled: an absent or stale id canonicalizes to the remembered
// view (or the first one) with a history REPLACE, so no dead entry is left
// behind for back to land on.
import { useEffect } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { navigate } from "../routes";
import { SAVE_VIEWS_KEY } from "./useSavedViews";
import type { SavedView } from "../shared/review-types";
import { useUiStore } from "../state/uiStore";

export function useActiveView(views: SavedView[] | undefined) {
  const savePending = useIsMutating({ mutationKey: SAVE_VIEWS_KEY }) > 0;
  const route = useUiStore((s) => s.route);
  const setLastViewId = useUiStore((s) => s.setLastViewId);
  const routeViewId = route.name === "queue" ? route.viewId : null;
  const activeView = views?.find((v) => v.id === routeViewId) ?? null;

  useEffect(() => {
    // While a save is in flight `views` is stale — canonicalizing against it
    // would bounce the selection off a just-created view.
    if (savePending || !views?.length) return;
    if (activeView) {
      setLastViewId(activeView.id);
      return;
    }
    const remembered = useUiStore.getState().lastViewId;
    const fallback = views.find((v) => v.id === remembered) ?? views[0];
    navigate({ name: "queue", viewId: fallback.id }, { replace: true });
  }, [views, activeView, savePending, setLastViewId]);

  return { activeViewId: activeView?.id ?? null, activeView };
}
