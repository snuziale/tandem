// Last-seen tracking, ~/.tandem/seen.json: when the reviewer last opened each
// PR and how fresh it was then. The queue compares a PR's updatedAt against
// this to show the "unseen changes" marker. Pruned so PRs that left every
// view don't accumulate forever.
import { isPlainObject } from "../../shared/isPlainObject";
import type { SeenRecord } from "../../shared/review-types";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "seen.json";
const MAX_RECORDS = 2000;

function file(): string {
  return storagePath(FILE);
}

async function readAll(): Promise<Record<string, SeenRecord>> {
  const text = await readTextFile(file());
  if (text === null) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (isPlainObject(raw) && isPlainObject(raw.seen))
      return raw.seen as Record<string, SeenRecord>;
  } catch {
    console.error(`[seen] ${file()} is malformed; starting empty`);
  }
  return {};
}

export async function loadSeen(): Promise<Record<string, SeenRecord>> {
  return readAll();
}

export async function markSeen(prId: string, updatedAt: string): Promise<void> {
  await enqueueMutation(file(), async () => {
    const seen = await readAll();
    seen[prId] = { prId, updatedAt, seenAt: new Date().toISOString() };
    // Cheap prune: drop the oldest-seen entries past the cap.
    const entries = Object.entries(seen);
    if (entries.length > MAX_RECORDS) {
      entries.sort((a, b) => a[1].seenAt.localeCompare(b[1].seenAt));
      for (const [key] of entries.slice(0, entries.length - MAX_RECORDS))
        delete seen[key];
    }
    await writeTextFile(file(), JSON.stringify({ seen }, null, 2));
  });
}
