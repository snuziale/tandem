import { describe, expect, it } from 'vitest';
import { refreshAge, relativeAge } from './time';

const NOW = new Date('2026-08-21T12:00:00Z').getTime();

describe('relativeAge', () => {
  it('formats compact ages', () => {
    expect(relativeAge('2026-08-21T11:59:40Z', NOW)).toBe('just now');
    expect(relativeAge('2026-08-21T11:45:00Z', NOW)).toBe('15m ago');
    expect(relativeAge('2026-08-21T10:00:00Z', NOW)).toBe('2h ago');
    expect(relativeAge('2026-08-20T13:00:00Z', NOW)).toBe('23h ago');
    expect(relativeAge('2026-08-20T10:00:00Z', NOW)).toBe('yesterday');
    expect(relativeAge('2026-08-18T12:00:00Z', NOW)).toBe('3d ago');
    expect(relativeAge('2026-07-01T12:00:00Z', NOW)).toBe('7w ago');
  });
  it('is empty for garbage input', () => {
    expect(relativeAge('not a date', NOW)).toBe('');
  });
});

describe('refreshAge', () => {
  it('ticks in seconds then minutes', () => {
    expect(refreshAge(NOW - 40_000, NOW)).toBe('refreshed 40s ago');
    expect(refreshAge(NOW - 3 * 60_000, NOW)).toBe('refreshed 3m ago');
    expect(refreshAge(0, NOW)).toBe('');
  });
});
