// A daily rollup of pulse counts per view, so the queue can show a TREND
// without becoming a queue journal.
//
// The stats drawer is a snapshot by construction — the queue payload is the
// currently-open PRs, and it says so out loud. That rule stands. What this
// adds is deliberately the smallest thing that is still honest: five integers
// and a total, once per view per day, last write wins. It answers "is the
// blocked-on-you pile growing?" and nothing else. It is NOT a per-PR history
// and cannot be turned into one — a real journal would have to record rows,
// and that is a different feature with a different storage story.
//
// Pure; the server owns the file (~/.tandem/pulse.json).
import { emptyPulseCounts, PULSE_STATES, type PulseCounts } from "./pulse";
import { isPlainObject } from "./is-plain-object";

/** ~3 months of five-integer rows per view — kilobytes, not megabytes. */
export const JOURNAL_MAX_DAYS = 90;

export type PulseSnapshot = {
  /** Local calendar day, `YYYY-MM-DD`. Local, not UTC: "today" has to mean
   * the reviewer's today or the newest bar lies for half the world. */
  day: string;
  total: number;
  counts: PulseCounts;
};

export type PulseJournal = {
  /** Keyed by view id. Ordered oldest → newest. */
  series: Record<string, PulseSnapshot[]>;
};

export function emptyJournal(): PulseJournal {
  return { series: {} };
}

export function dayKeyOf(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Upsert today's row for one view. Last write wins within a day: the queue
 * polls every 60s and each poll is a better reading than the one before it,
 * so the last snapshot of the day is the day's number.
 */
export function recordSnapshot(
  journal: PulseJournal,
  key: string,
  snapshot: PulseSnapshot,
  maxDays = JOURNAL_MAX_DAYS,
): PulseJournal {
  const existing = journal.series[key] ?? [];
  const without = existing.filter((s) => s.day !== snapshot.day);
  const next = [...without, snapshot]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-maxDays);
  return { series: { ...journal.series, [key]: next } };
}

/** Drop series for views that no longer exist, so a deleted view's history
 * does not linger forever in a file nobody can see. */
export function pruneJournal(
  journal: PulseJournal,
  liveKeys: readonly string[],
): PulseJournal {
  const live = new Set(liveKeys);
  const series: PulseJournal["series"] = {};
  for (const [key, rows] of Object.entries(journal.series))
    if (live.has(key)) series[key] = rows;
  return { series };
}

export function seriesOf(
  journal: PulseJournal,
  key: string,
  days?: number,
): PulseSnapshot[] {
  const rows = journal.series[key] ?? [];
  return days ? rows.slice(-days) : rows;
}

export function validateJournal(raw: unknown): PulseJournal {
  if (!isPlainObject(raw) || !isPlainObject(raw.series)) return emptyJournal();
  const series: PulseJournal["series"] = {};
  for (const [key, rows] of Object.entries(raw.series)) {
    if (!Array.isArray(rows)) continue;
    const clean = rows
      .map(validateSnapshot)
      .filter((s): s is PulseSnapshot => s !== null)
      .sort((a, b) => a.day.localeCompare(b.day));
    if (clean.length) series[key] = clean;
  }
  return { series };
}

function validateSnapshot(raw: unknown): PulseSnapshot | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day))
    return null;
  const counts = emptyPulseCounts();
  const source = isPlainObject(raw.counts) ? raw.counts : {};
  for (const state of PULSE_STATES) {
    const value = source[state];
    counts[state] = typeof value === "number" && value >= 0 ? value : 0;
  }
  const total =
    typeof raw.total === "number" && raw.total >= 0
      ? raw.total
      : PULSE_STATES.reduce((sum, s) => sum + counts[s], 0);
  return { day: raw.day, total, counts };
}
