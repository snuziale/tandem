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
  | { name: "queue"; viewId: string | null }
  | { name: "pr"; owner: string; repo: string; number: number; prId: PrId }
  | { name: "settings" };

/** Query param carrying the queue's selected view id. */
const VIEW_PARAM = "view";

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
  return { name: "queue", viewId: new URLSearchParams(search).get(VIEW_PARAM) };
}

export function pathOfRoute(route: Route): string {
  switch (route.name) {
    case "queue":
      return route.viewId
        ? `/?${VIEW_PARAM}=${encodeURIComponent(route.viewId)}`
        : "/";
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
 * so a cold launch also restores it). Every "← Queue" affordance uses this.
 */
export function navigateToQueue(): void {
  navigate({ name: "queue", viewId: useUiStore.getState().lastViewId });
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
