// Saved queue views, persisted to ~/.tandem/views.json. Seeded on first load
// with the two views that are about YOU. Deliberately no org-wide view: an
// org's open PRs is thousands of rows nobody reads, and that one search costs
// ~9s of the queue's budget on every poll. Add one by hand if you want it.
import { randomUUID } from "node:crypto";
import type { SavedView } from "../../shared/review-types";
import { isPlainObject } from "../../shared/is-plain-object";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "views.json";

function file(): string {
  return storagePath(FILE);
}

function defaultViews(): SavedView[] {
  return [
    {
      id: randomUUID(),
      name: "Needs my review",
      query:
        "is:pr is:open review-requested:@me archived:false sort:updated-desc",
      agentEnabled: true,
      position: 0,
    },
    {
      id: randomUUID(),
      name: "My PRs",
      query: "is:pr is:open author:@me archived:false sort:updated-desc",
      agentEnabled: false,
      position: 1,
    },
  ];
}

export function validateView(raw: unknown): SavedView | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (typeof raw.query !== "string" || !raw.query.trim()) return null;
  return {
    id: raw.id,
    name: raw.name,
    query: raw.query,
    agentEnabled: raw.agentEnabled === true,
    position: typeof raw.position === "number" ? raw.position : 0,
  };
}

export async function loadViews(): Promise<SavedView[]> {
  const text = await readTextFile(file());
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as { views?: unknown[] };
      const views = (raw.views ?? [])
        .map(validateView)
        .filter((v): v is SavedView => v !== null);
      return views.sort((a, b) => a.position - b.position);
    } catch {
      console.error(
        `[views] ${file()} is malformed; serving defaults without overwriting it`,
      );
      return defaultViews();
    }
  }
  const seeded = defaultViews();
  await saveViews(seeded);
  return seeded;
}

export async function saveViews(views: SavedView[]): Promise<void> {
  const normalized = views.map((v, i) => ({ ...v, position: i }));
  await enqueueMutation(file(), () =>
    writeTextFile(file(), JSON.stringify({ views: normalized }, null, 2)),
  );
}
