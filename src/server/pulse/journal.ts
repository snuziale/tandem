// ~/.tandem/pulse.json — the daily pulse rollup.
//
// Written from the queue poll, after the response has already been sent. It is
// deliberately the cheapest possible trend: one row per view per day, five
// integers and a total, last write wins. See shared/pulse-journal.ts for why
// it stops there rather than growing into a queue journal.
import {
  dayKeyOf,
  emptyJournal,
  pruneJournal,
  recordSnapshot,
  seriesOf,
  validateJournal,
  type PulseJournal,
  type PulseSnapshot,
} from "../../shared/pulse-journal";
import { pulseCounts } from "../../shared/pulse";
import type { QueueResult } from "../../shared/review-types";
import { resolveLogin } from "../config/routes";
import { loadSettings } from "../settings/store";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "pulse.json";

function file(): string {
  return storagePath(FILE);
}

export async function loadJournal(): Promise<PulseJournal> {
  const text = await readTextFile(file());
  if (text === null) return emptyJournal();
  try {
    return validateJournal(JSON.parse(text));
  } catch {
    console.error(`[pulse] ${file()} is malformed; starting a fresh journal`);
    return emptyJournal();
  }
}

export async function historyFor(
  viewId: string,
  days?: number,
): Promise<PulseSnapshot[]> {
  return seriesOf(await loadJournal(), viewId, days);
}

/**
 * Fold one queue response into today's rows. Fire-and-forget from the queue
 * route: a journal write must never delay or fail a poll, so everything here
 * swallows its own errors.
 */
export async function recordQueuePulse(result: QueueResult): Promise<void> {
  try {
    const settings = await loadSettings();
    if (!settings.pulse.journalEnabled) return;
    const viewer = await resolveLogin();
    const now = Date.now();
    const day = dayKeyOf(now);
    const opts = {
      now,
      viewerLogin: viewer,
      rottingDays: settings.pulse.rottingDays,
    };

    // Read-modify-write inside ONE queued mutation, or two concurrent polls
    // can each read the same journal and the later write loses the earlier
    // view's row.
    await enqueueMutation(file(), async () => {
      const before = await readTextFile(file());
      let journal = validateJournal(JSON.parse(before ?? "{}"));
      for (const [viewId, rows] of Object.entries(result.views)) {
        // A view whose search failed has no rows to describe — recording a
        // zero there would draw a cliff into the chart that never happened.
        if (result.errors[viewId] && rows.length === 0) continue;
        journal = recordSnapshot(journal, viewId, {
          day,
          total: rows.length,
          counts: pulseCounts(rows, opts),
        });
      }
      // The views in this poll ARE the live set — a deleted view's series
      // would otherwise sit in the file forever with nothing able to show it.
      journal = pruneJournal(journal, Object.keys(result.views));
      // One row per view per DAY, so most of the ~1440 polls in a day produce
      // a byte-identical file. Skipping the identical ones turns the queue
      // poll's tail from a temp-write + chmod + rename into a read.
      const next = JSON.stringify(journal, null, 2);
      if (next === before) return;
      await writeTextFile(file(), next);
    });
  } catch (e) {
    console.error(
      `[pulse] journal write failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
