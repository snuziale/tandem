// User-tunable settings served by /api/settings and persisted server-side in
// ~/.tandem/settings.json. Defaults here are the spec's defaults.
import type { Severity } from './agent-types';
import { DEFAULT_PROMPTS, type PromptTexts } from './prompt-defaults';

export type PassModels = {
  orient: string;
  analyze: string;
  reconcile: string;
};

export type TandemSettings = {
  /** Pre-warming: start runs automatically as PRs enter agent-enabled views.
   * OFF by default — runs are user-initiated (rerun button / `r`) unless the
   * user explicitly opts in. */
  autoRunEnabled: boolean;
  /** Findings below this severity collapse into the Nits group in the agent pane. */
  severityThreshold: Extract<Severity, 'blocker' | 'risk' | 'nit'>;
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
  models: PassModels;
  /** The editable halves of the agent prompts; data blocks and the JSON
   * output contracts stay code-owned (they must match the zod schemas). */
  prompts: PromptTexts;
};

export const DEFAULT_SETTINGS: TandemSettings = {
  autoRunEnabled: false,
  severityThreshold: 'risk',
  maxChangedFiles: 40,
  maxDiffLines: 3000,
  skipDrafts: true,
  findingCap: 8,
  nitCap: 3,
  dailyCostUsd: 20,
  repos: {},
  agentEnabledByDefault: true,
  models: {
    orient: 'haiku',
    analyze: 'sonnet',
    reconcile: 'sonnet',
  },
  prompts: DEFAULT_PROMPTS,
};
