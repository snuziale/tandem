// Tandem settings, ~/.tandem/settings.json. Missing file = defaults; unknown
// keys are dropped on save. Values merge over DEFAULT_SETTINGS so adding a
// setting never requires a migration.
import { isPlainObject } from "../../shared/is-plain-object";
import { promptTextsOf } from "../../shared/prompt-defaults";
import {
  DEFAULT_AGENT,
  DEFAULT_SETTINGS,
  type AgentProfile,
  type TandemSettings,
} from "../../shared/settings-types";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "settings.json";

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
  await enqueueMutation(file(), () =>
    writeTextFile(file(), JSON.stringify(next, null, 2)),
  );
  return next;
}

export function sanitize(raw: unknown): TandemSettings {
  const d = DEFAULT_SETTINGS;
  if (!isPlainObject(raw)) return d;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  const threshold = raw.severityThreshold;
  const repos: TandemSettings["repos"] = {};
  if (isPlainObject(raw.repos)) {
    for (const [key, value] of Object.entries(raw.repos)) {
      if (isPlainObject(value) && typeof value.agentEnabled === "boolean")
        repos[key] = { agentEnabled: value.agentEnabled };
    }
  }
  return {
    autoRunEnabled: raw.autoRunEnabled === true,
    severityThreshold:
      threshold === "blocker" || threshold === "risk" || threshold === "nit"
        ? threshold
        : d.severityThreshold,
    maxChangedFiles: num(raw.maxChangedFiles, d.maxChangedFiles),
    maxDiffLines: num(raw.maxDiffLines, d.maxDiffLines),
    skipDrafts:
      typeof raw.skipDrafts === "boolean" ? raw.skipDrafts : d.skipDrafts,
    findingCap: num(raw.findingCap, d.findingCap),
    nitCap: num(raw.nitCap, d.nitCap),
    dailyCostUsd: num(raw.dailyCostUsd, d.dailyCostUsd),
    repos,
    agentEnabledByDefault:
      typeof raw.agentEnabledByDefault === "boolean"
        ? raw.agentEnabledByDefault
        : d.agentEnabledByDefault,
    ...sanitizeAgents(raw),
    autoApprove: sanitizeAutoApprove(raw.autoApprove),
    pulse: sanitizePulse(raw.pulse),
  };
}

function sanitizeModels(raw: unknown): AgentProfile["models"] {
  const models = isPlainObject(raw) ? raw : {};
  const d = DEFAULT_AGENT.models;
  const pick = (key: keyof AgentProfile["models"]) => {
    const value = models[key];
    return typeof value === "string" && value ? value : d[key];
  };
  return {
    orient: pick("orient"),
    analyze: pick("analyze"),
    reconcile: pick("reconcile"),
    chat: pick("chat"),
  };
}

function sanitizePulse(raw: unknown): TandemSettings["pulse"] {
  const d = DEFAULT_SETTINGS.pulse;
  if (!isPlainObject(raw)) return d;
  const days = raw.rottingDays;
  return {
    // A zero-day rotting line would paint the whole queue red, so the floor is
    // one day rather than zero.
    rottingDays:
      typeof days === "number" && Number.isFinite(days) && days >= 1
        ? days
        : d.rottingDays,
    menuViewId:
      typeof raw.menuViewId === "string" && raw.menuViewId
        ? raw.menuViewId
        : null,
    journalEnabled:
      typeof raw.journalEnabled === "boolean"
        ? raw.journalEnabled
        : d.journalEnabled,
  };
}

function sanitizeAgents(
  raw: Record<string, unknown>,
): Pick<TandemSettings, "agents" | "defaultAgentId"> {
  const agents: AgentProfile[] = [];
  if (Array.isArray(raw.agents)) {
    for (const entry of raw.agents) {
      if (
        !isPlainObject(entry) ||
        typeof entry.id !== "string" ||
        !entry.id ||
        typeof entry.name !== "string" ||
        !entry.name.trim()
      )
        continue;
      agents.push({
        id: entry.id,
        name: entry.name,
        description:
          typeof entry.description === "string" && entry.description
            ? entry.description
            : undefined,
        models: sanitizeModels(entry.models),
        prompts: promptTextsOf(entry.prompts),
      });
    }
  }
  if (agents.length === 0) {
    // Migration: pre-profile settings kept a single top-level models+prompts
    // pair — fold it into the default profile so nothing the user tuned is lost.
    agents.push({
      ...DEFAULT_AGENT,
      models: sanitizeModels(raw.models),
      prompts: promptTextsOf(raw.prompts),
    });
  }
  const defaultAgentId =
    typeof raw.defaultAgentId === "string" &&
    agents.some((a) => a.id === raw.defaultAgentId)
      ? raw.defaultAgentId
      : agents[0].id;
  return { agents, defaultAgentId };
}

function sanitizeAutoApprove(raw: unknown): TandemSettings["autoApprove"] {
  const d = DEFAULT_SETTINGS.autoApprove;
  if (!isPlainObject(raw)) return d;
  return {
    // Never defaults on: unattended approval is explicit opt-in.
    enabled: raw.enabled === true,
    minScore:
      typeof raw.minScore === "number" &&
      raw.minScore >= 0 &&
      raw.minScore <= 100
        ? raw.minScore
        : d.minScore,
    requireChecksPassing:
      typeof raw.requireChecksPassing === "boolean"
        ? raw.requireChecksPassing
        : d.requireChecksPassing,
  };
}

export function agentEnabledFor(
  settings: TandemSettings,
  repoKey: string,
): boolean {
  return (
    settings.repos[repoKey]?.agentEnabled ?? settings.agentEnabledByDefault
  );
}
