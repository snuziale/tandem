// User-tunable settings served by /api/settings and persisted server-side in
// ~/.tandem/settings.json. Defaults here are the spec's defaults.
import type { Severity } from "./agent-types";
import { DEFAULT_ROTTING_DAYS } from "./pulse";
import { DEFAULT_PROMPTS, type PromptTexts } from "./prompt-defaults";

export type PassModels = {
  orient: string;
  analyze: string;
  reconcile: string;
  /** The interactive chat pass — the reviewer is waiting on it, so it wants a
   * model that is fast AND good at prose, not just at strict JSON. */
  chat: string;
};

/** A configured reviewer: its own models and prompt blocks, so different
 * agents can specialize (security sweep, test-coverage, API-contract, …).
 * Every run records which agent produced it. */
export type AgentProfile = {
  id: string;
  name: string;
  description?: string;
  /** The starter preset this profile was created from (shared/agent-presets.ts),
   * if any. Copied text is the profile's own from then on — this is kept only
   * so a prompt field's "reset to default" returns to the LENS it came from
   * rather than to the general reviewer's wording. */
  presetId?: string;
  models: PassModels;
  prompts: PromptTexts;
};

export const DEFAULT_AGENT: AgentProfile = {
  id: "general",
  name: "General reviewer",
  description: "Balanced correctness-first review of the whole diff.",
  models: {
    orient: "haiku",
    analyze: "sonnet",
    reconcile: "sonnet",
    chat: "sonnet",
  },
  prompts: DEFAULT_PROMPTS,
};

/**
 * How the queue reads a cohort: the staleness line every "rotting" mark is
 * drawn against, the default grouping, and whether the daily rollup is kept.
 *
 * `rottingDays` is a SETTING and not a constant because the number is a team
 * norm, not a fact — a repo that ships twice a day and one that ships monthly
 * disagree about when silence becomes a problem.
 */
export type PulseSettings = {
  rottingDays: number;
  /**
   * The view the menu-bar feed (/api/pulse.xbar) reads when the request names
   * none. Null = every view, merged and deduped.
   */
  menuViewId: string | null;
  /** Roll one row of pulse counts per view per day into ~/.tandem/pulse.json.
   * Five integers a day; see shared/pulse-journal.ts for why it stops there. */
  journalEnabled: boolean;
};

/** Opt-in unattended approval — the ONE exception to "the agent never writes
 * to GitHub", disabled by default and gated hard (see maybeAutoApprove). */
export type AutoApproveSettings = {
  enabled: boolean;
  /** Minimum pass-3 merge-readiness score (0-100). */
  minScore: number;
  requireChecksPassing: boolean;
};

export type TandemSettings = {
  /** Pre-warming: start runs automatically as PRs enter agent-enabled views.
   * OFF by default — runs are user-initiated (rerun button / `r`) unless the
   * user explicitly opts in. */
  autoRunEnabled: boolean;
  /** Findings below this severity collapse into the Nits group in the agent pane. */
  severityThreshold: Extract<Severity, "blocker" | "risk" | "nit">;
  /** Skip the run entirely above these sizes (spec §4 cost caps). */
  maxChangedFiles: number;
  maxDiffLines: number;
  skipDrafts: boolean;
  /** Hard caps enforced by pass 3. */
  findingCap: number;
  nitCap: number;
  /** Daily agent spend ceiling in USD; runs skip with reason 'budget' when hit. */
  dailyCostUsd: number;
  /** Per-repo agent enablement, keyed "owner/name". Repos absent here inherit
   * `agentEnabledByDefault`. */
  repos: Record<string, { agentEnabled: boolean }>;
  agentEnabledByDefault: boolean;
  /** Configured reviewer profiles; `defaultAgentId` picks which one automatic
   * and unqualified manual runs use. */
  agents: AgentProfile[];
  defaultAgentId: string;
  autoApprove: AutoApproveSettings;
  pulse: PulseSettings;
};

export const DEFAULT_SETTINGS: TandemSettings = {
  autoRunEnabled: false,
  severityThreshold: "risk",
  maxChangedFiles: 40,
  maxDiffLines: 3000,
  skipDrafts: true,
  findingCap: 8,
  nitCap: 3,
  dailyCostUsd: 20,
  repos: {},
  agentEnabledByDefault: true,
  agents: [DEFAULT_AGENT],
  defaultAgentId: DEFAULT_AGENT.id,
  pulse: {
    rottingDays: DEFAULT_ROTTING_DAYS,
    menuViewId: null,
    journalEnabled: true,
  },
  autoApprove: {
    enabled: false,
    minScore: 90,
    requireChecksPassing: true,
  },
};

export function agentById(
  settings: TandemSettings,
  agentId: string | undefined,
): AgentProfile {
  return (
    settings.agents.find((a) => a.id === agentId) ??
    settings.agents.find((a) => a.id === settings.defaultAgentId) ??
    settings.agents[0] ??
    DEFAULT_AGENT
  );
}

/**
 * Is the agent on for this repo? The per-repo toggle, with the global default
 * behind it.
 *
 * In shared beside the type it reads, because the PANE asks it too now: the
 * pre-flight card tells the reviewer a run would be skipped before they spend
 * one, and a client-side second opinion on this rule would be a promise the
 * server had no reason to keep.
 */
export function agentEnabledFor(
  settings: TandemSettings,
  repoKey: string,
): boolean {
  return (
    settings.repos[repoKey]?.agentEnabled ?? settings.agentEnabledByDefault
  );
}
