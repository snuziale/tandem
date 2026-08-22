// History-API routing (Sift pattern): `/` queue, `/:owner/:repo/pull/:number`
// PR detail, `/settings`. The server SPA-falls-back every non-asset path to
// index.html, so deep links work in both dev and the native app.
import { useEffect } from 'react';
import { prIdOf } from './shared/gh/prKey';
import type { PrId } from './shared/review-types';
import { useUiStore } from './state/uiStore';

export type Route =
  | { name: 'queue' }
  | { name: 'pr'; owner: string; repo: string; number: number; prId: PrId }
  | { name: 'settings' };

export function routeOfPath(pathname: string): Route {
  if (pathname === '/settings') return { name: 'settings' };
  const pr = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(pathname);
  if (pr) {
    const owner = decodeURIComponent(pr[1]);
    const repo = decodeURIComponent(pr[2]);
    const number = Number(pr[3]);
    return { name: 'pr', owner, repo, number, prId: prIdOf(owner, repo, number) };
  }
  return { name: 'queue' };
}

export function pathOfRoute(route: Route): string {
  switch (route.name) {
    case 'queue':
      return '/';
    case 'settings':
      return '/settings';
    case 'pr':
      return `/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/pull/${route.number}`;
  }
}

export function navigate(route: Route): void {
  history.pushState({}, '', pathOfRoute(route));
  useUiStore.getState().setRoute(route);
}

/** Resolve the initial route and follow back/forward. Mount once (App). */
export function useRouteSync(): void {
  useEffect(() => {
    const apply = () => useUiStore.getState().setRoute(routeOfPath(window.location.pathname));
    apply();
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, []);
}
