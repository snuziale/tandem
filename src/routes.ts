// History-API routing (Sift pattern): `/` queue, `/?view=<id>` queue on a saved
// view, `/:owner/:repo/pull/:number` PR detail, `/settings`. The server
// SPA-falls-back every non-asset path to index.html, so deep links work in both
// dev and the native app.
//
// The queue's SELECTED VIEW lives in the URL, not in component state: tab
// switches are history entries (back/forward moves between views), a link to a
// view survives a reload, and back-from-PR-detail lands on the view you left.
import { useEffect } from "react";
import { prIdOf } from "./shared/gh/prKey";
import type { PrId } from "./shared/review-types";
import { useUiStore } from "./state/uiStore";

export type Route =
  | {
      name: "queue";
      viewId: string | null;
      /**
       * The stats drawer's active slice, as `dim:value` (see
       * utils/queueStats.ts). URL state for the same reason the view is: a
       * filtered queue is linkable, and back undoes the filter rather than
       * leaving the reader on a subset they can't see the cause of.
       */
      facet: string | null;
    }
  | { name: "pr"; owner: string; repo: string; number: number; prId: PrId }
  | { name: "settings" };

/** Query params carrying the queue's selected view and its stats facet. */
const VIEW_PARAM = "view";
const FACET_PARAM = "by";

export function routeOfLocation(pathname: string, search = ""): Route {
  if (pathname === "/settings") return { name: "settings" };
  const pr = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(pathname);
  if (pr) {
    const owner = decodeURIComponent(pr[1]);
    const repo = decodeURIComponent(pr[2]);
    const number = Number(pr[3]);
    return {
      name: "pr",
      owner,
      repo,
      number,
      prId: prIdOf(owner, repo, number),
    };
  }
  const params = new URLSearchParams(search);
  return {
    name: "queue",
    viewId: params.get(VIEW_PARAM),
    facet: params.get(FACET_PARAM),
  };
}

export function pathOfRoute(route: Route): string {
  switch (route.name) {
    case "queue": {
      const params = new URLSearchParams();
      if (route.viewId) params.set(VIEW_PARAM, route.viewId);
      if (route.facet) params.set(FACET_PARAM, route.facet);
      const search = params.toString();
      return search ? `/?${search}` : "/";
    }
    case "settings":
      return "/settings";
    case "pr":
      return `/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/pull/${route.number}`;
  }
}

/** `replace` for canonicalizing the current URL — never for a user navigation. */
export function navigate(route: Route, options?: { replace?: boolean }): void {
  const path = pathOfRoute(route);
  if (options?.replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  useUiStore.getState().setRoute(route);
}

/**
 * Back to the queue, landing on the view the user last had selected (persisted,
 * so a cold launch also restores it) AND the stats facet they left it on — a
 * drill-down survives a round trip into a PR. Every "← Queue" affordance and
 * the detail screen's `esc` use this.
 */
export function navigateToQueue(): void {
  const { lastViewId, lastFacet } = useUiStore.getState();
  navigate({ name: "queue", viewId: lastViewId, facet: lastFacet });
}

/** Resolve the initial route and follow back/forward. Mount once (App). */
export function useRouteSync(): void {
  useEffect(() => {
    const apply = () =>
      useUiStore
        .getState()
        .setRoute(
          routeOfLocation(window.location.pathname, window.location.search),
        );
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);
}
