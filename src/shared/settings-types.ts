// User-tunable settings served by /api/settings and persisted server-side in
// ~/.tandem/settings.json. Defaults here are the spec's defaults.
import type { Severity } from "./agent-types";
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
