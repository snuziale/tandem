import { describe, expect, it } from 'vitest';
import { buildQueueQuery } from './queueQuery';

describe('buildQueueQuery', () => {
  it('aliases one search per view and maps aliases back to view ids', () => {
    const { gql, aliasToViewId } = buildQueueQuery([
      { id: 'needs-review', query: 'is:pr is:open review-requested:@me' },
      { id: 'mine', query: 'is:pr is:open author:@me' },
    ]);
    expect(aliasToViewId).toEqual({ v0: 'needs-review', v1: 'mine' });
    expect(gql).toContain('v0: search(type: ISSUE, first: 50, query: "is:pr is:open review-requested:@me")');
    expect(gql).toContain('v1: search(');
    expect(gql).toContain('rateLimit { remaining limit resetAt }');
    expect(gql).toContain('fragment PrFields on PullRequest');
  });

  it('escapes user-authored queries as JSON string literals', () => {
    const { gql } = buildQueueQuery([{ id: 'x', query: 'is:pr "quoted \\ term"' }]);
    expect(gql).toContain(String.raw`query: "is:pr \"quoted \\ term\""`);
  });
});
