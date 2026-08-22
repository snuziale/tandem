import { describe, expect, it } from 'vitest';
import { parseViewsJson } from './viewsJson';

describe('parseViewsJson', () => {
  it('accepts a valid array and fills id/position defaults', () => {
    const result = parseViewsJson(JSON.stringify([{ name: 'Repo only', query: 'is:pr repo:a/b' }]));
    expect('views' in result).toBe(true);
    if ('views' in result) {
      expect(result.views[0].name).toBe('Repo only');
      expect(result.views[0].id).toBeTruthy();
      expect(result.views[0].position).toBe(0);
      expect(result.views[0].agentEnabled).toBe(false);
    }
  });

  it('rejects malformed payloads with a pointed error', () => {
    expect(parseViewsJson('not json')).toHaveProperty('error');
    expect(parseViewsJson('{}')).toEqual({ error: 'expected a top-level array of views' });
    expect(parseViewsJson('[]')).toEqual({ error: 'at least one view is required' });
    expect(parseViewsJson(JSON.stringify([{ name: '', query: 'x' }]))).toEqual({ error: 'view 0: name and query are required strings' });
    expect(parseViewsJson(JSON.stringify([{ name: 'a', query: 'q' }, { name: 'b' }]))).toEqual({
      error: 'view 1: name and query are required strings',
    });
  });

  it('preserves explicit ids and positions (shareable round-trip)', () => {
    const input = [{ id: 'v1', name: 'A', query: 'q', agentEnabled: true, position: 3 }];
    const result = parseViewsJson(JSON.stringify(input));
    if ('views' in result) expect(result.views[0]).toEqual(input[0]);
    else throw new Error(result.error);
  });
});
