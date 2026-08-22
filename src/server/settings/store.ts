// Tandem settings, ~/.tandem/settings.json. Missing file = defaults; unknown
// keys are dropped on save. Values merge over DEFAULT_SETTINGS so adding a
// setting never requires a migration.
import { isPlainObject } from '../../shared/isPlainObject';
import { promptTextsOf } from '../../shared/prompt-defaults';
import { DEFAULT_SETTINGS, type TandemSettings } from '../../shared/settings-types';
import { enqueueMutation, readTextFile, storagePath, writeTextFile } from '../storage/jsonFile';

const FILE = 'settings.json';

function file(): string {
  return storagePath(FILE);
}

export async function loadSettings(): Promise<TandemSettings> {
  const text = await readTextFile(file());
  if (text === null) return DEFAULT_SETTINGS;
  try {
    return sanitize(JSON.parse(text));
  } catch {
    console.error(`[settings] ${file()} is malformed; serving defaults`);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(raw: unknown): Promise<TandemSettings> {
  const next = sanitize(raw);
  await enqueueMutation(file(), () => writeTextFile(file(), JSON.stringify(next, null, 2)));
  return next;
}

export function sanitize(raw: unknown): TandemSettings {
  const d = DEFAULT_SETTINGS;
  if (!isPlainObject(raw)) return d;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const threshold = raw.severityThreshold;
  const models = isPlainObject(raw.models) ? raw.models : {};
  const repos: TandemSettings['repos'] = {};
  if (isPlainObject(raw.repos)) {
    for (const [key, value] of Object.entries(raw.repos)) {
      if (isPlainObject(value) && typeof value.agentEnabled === 'boolean') repos[key] = { agentEnabled: value.agentEnabled };
    }
  }
  return {
    autoRunEnabled: raw.autoRunEnabled === true,
    severityThreshold: threshold === 'blocker' || threshold === 'risk' || threshold === 'nit' ? threshold : d.severityThreshold,
    maxChangedFiles: num(raw.maxChangedFiles, d.maxChangedFiles),
    maxDiffLines: num(raw.maxDiffLines, d.maxDiffLines),
    skipDrafts: typeof raw.skipDrafts === 'boolean' ? raw.skipDrafts : d.skipDrafts,
    findingCap: num(raw.findingCap, d.findingCap),
    nitCap: num(raw.nitCap, d.nitCap),
    dailyCostUsd: num(raw.dailyCostUsd, d.dailyCostUsd),
    repos,
    agentEnabledByDefault: typeof raw.agentEnabledByDefault === 'boolean' ? raw.agentEnabledByDefault : d.agentEnabledByDefault,
    models: {
      orient: typeof models.orient === 'string' && models.orient ? models.orient : d.models.orient,
      analyze: typeof models.analyze === 'string' && models.analyze ? models.analyze : d.models.analyze,
      reconcile: typeof models.reconcile === 'string' && models.reconcile ? models.reconcile : d.models.reconcile,
    },
    prompts: promptTextsOf(raw.prompts),
  };
}

export function agentEnabledFor(settings: TandemSettings, repoKey: string): boolean {
  return settings.repos[repoKey]?.agentEnabled ?? settings.agentEnabledByDefault;
}
