// Saved queue views, persisted to ~/.tandem/views.json. Seeded with the
// spec's defaults on first load — the Team view only when a default org is
// configured, since its query needs one.
import { randomUUID } from 'node:crypto';
import type { SavedView } from '../../shared/review-types';
import { isPlainObject } from '../../shared/isPlainObject';
import { loadConfig } from '../config/store';
import { enqueueMutation, readTextFile, storagePath, writeTextFile } from '../storage/jsonFile';

const FILE = 'views.json';

function file(): string {
  return storagePath(FILE);
}

function defaultViews(org: string | undefined): SavedView[] {
  const views: SavedView[] = [
    { id: randomUUID(), name: 'Needs my review', query: 'is:pr is:open review-requested:@me archived:false sort:updated-desc', agentEnabled: true, position: 0 },
    { id: randomUUID(), name: 'My PRs', query: 'is:pr is:open author:@me archived:false sort:updated-desc', agentEnabled: false, position: 1 },
  ];
  if (org) {
    views.push({
      id: randomUUID(),
      name: 'Team',
      query: `is:pr is:open org:${org} -author:@me archived:false sort:updated-desc`,
      agentEnabled: false,
      position: 2,
    });
  }
  return views;
}

export function validateView(raw: unknown): SavedView | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (typeof raw.query !== 'string' || !raw.query.trim()) return null;
  return {
    id: raw.id,
    name: raw.name,
    query: raw.query,
    agentEnabled: raw.agentEnabled === true,
    position: typeof raw.position === 'number' ? raw.position : 0,
  };
}

export async function loadViews(): Promise<SavedView[]> {
  const text = await readTextFile(file());
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as { views?: unknown[] };
      const views = (raw.views ?? []).map(validateView).filter((v): v is SavedView => v !== null);
      return views.sort((a, b) => a.position - b.position);
    } catch {
      console.error(`[views] ${file()} is malformed; serving defaults without overwriting it`);
      return defaultViews((await loadConfig())?.github.defaultOrg || undefined);
    }
  }
  const seeded = defaultViews((await loadConfig())?.github.defaultOrg || undefined);
  await saveViews(seeded);
  return seeded;
}

export async function saveViews(views: SavedView[]): Promise<void> {
  const normalized = views.map((v, i) => ({ ...v, position: i }));
  await enqueueMutation(file(), () => writeTextFile(file(), JSON.stringify({ views: normalized }, null, 2)));
}
