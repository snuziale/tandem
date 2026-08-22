// Compact relative ages for queue rows: "2h ago", "yesterday", "3d ago".
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 14 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return `${Math.floor(diff / (7 * DAY))}w ago`;
}

/** "refreshed 40s ago" ticker text for the query bar. */
export function refreshAge(dataUpdatedAt: number, now: number = Date.now()): string {
  if (!dataUpdatedAt) return '';
  const diff = Math.max(0, now - dataUpdatedAt);
  if (diff < MINUTE) return `refreshed ${Math.max(1, Math.floor(diff / 1000))}s ago`;
  return `refreshed ${Math.floor(diff / MINUTE)}m ago`;
}
