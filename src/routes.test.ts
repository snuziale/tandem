import { describe, expect, it } from 'vitest';
import { pathOfRoute, routeOfPath } from './routes';

describe('routes', () => {
  it('parses queue, settings, and PR paths', () => {
    expect(routeOfPath('/')).toEqual({ name: 'queue' });
    expect(routeOfPath('/settings')).toEqual({ name: 'settings' });
    expect(routeOfPath('/uipath/flow-workbench/pull/234')).toEqual({
      name: 'pr',
      owner: 'uipath',
      repo: 'flow-workbench',
      number: 234,
      prId: 'uipath/flow-workbench#234',
    });
  });

  it('falls back to queue for unknown paths', () => {
    expect(routeOfPath('/nope')).toEqual({ name: 'queue' });
    expect(routeOfPath('/a/b/pull/x')).toEqual({ name: 'queue' });
  });

  it('round-trips', () => {
    const route = routeOfPath('/uipath/flow-workbench/pull/234');
    expect(routeOfPath(pathOfRoute(route))).toEqual(route);
  });
});
