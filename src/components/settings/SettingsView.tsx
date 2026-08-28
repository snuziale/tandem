import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Input,
  Label,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@uipath/apollo-wind";
import { ArrowLeft } from "lucide-react";
import { fetchAgentHealth } from "../../api/runs";
import { useAgentRuns } from "../../hooks/useAgentRuns";
import { useConfigStatus } from "../../hooks/useConfigStatus";
import { useSavedViews } from "../../hooks/useSavedViews";
import { useSaveSettings, useSettings } from "../../hooks/useSettings";
import { hasOpenDialog, isTypingTarget } from "../../keyboard/keyOwnership";
import { navigateToQueue } from "../../routes";
import {
  DEFAULT_PROMPTS,
  type PromptTexts,
} from "../../shared/prompt-defaults";
import {
  DEFAULT_AGENT,
  type AgentProfile,
  type TandemSettings,
} from "../../shared/settings-types";
import { AppHeader } from "../layout/AppHeader";
import { CredentialsForm } from "../setup/CredentialsForm";

export function SettingsView() {
  const status = useConfigStatus();
  const settingsQuery = useSettings();
  const save = useSaveSettings();
  const runs = useAgentRuns();
  const health = useQuery({
    queryKey: ["agent", "health"],
    queryFn: fetchAgentHealth,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasOpenDialog() && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigateToQueue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const settings = settingsQuery.data;
  const patch = (p: Partial<TandemSettings>) => save.mutate(p);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <AppHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <button
              type="button"
              className="flex items-center gap-1 hover:text-foreground"
              onClick={navigateToQueue}
            >
              <ArrowLeft className="w-3 h-3" /> Queue
            </button>
            <span>/</span>
            <span>Settings</span>
          </div>

          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold">GitHub</h2>
            {status.data ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {status.data.login ? (
                    <>
                      Reviews post as{" "}
                      <span className="font-mono text-foreground">
                        @{status.data.login}
                      </span>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  stored at{" "}
                  <code className="font-mono text-[11px]">
                    {status.data.configPath}
                  </code>
                </p>
                <CredentialsForm
                  fields={status.data.fields}
                  initialValues={status.data.currentValues}
                  submitLabel="Save credentials"
                  mode="update"
                  onSaved={() => status.refetch()}
                />
              </>
            ) : null}
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Agent</h2>
              <span className="text-xs text-muted-foreground font-mono">
                {health.data?.available
                  ? `claude ${health.data.version ?? ""}`
                  : health.data
                    ? "claude CLI unavailable"
                    : ""}
              </span>
            </div>

            {settings ? (
              <>
                <ToggleRow
                  label="Run automatically (pre-warm)"
                  hint="Off: the agent only runs when you press rerun (r) on a PR. On: PRs entering agent-enabled views are analyzed in the background."
                  checked={settings.autoRunEnabled}
                  onChange={(v) => patch({ autoRunEnabled: v })}
                />
                <ToggleRow
                  label="Analyze PRs by default"
                  hint="Repos can override below. Applies to manual and automatic runs."
                  checked={settings.agentEnabledByDefault}
                  onChange={(v) => patch({ agentEnabledByDefault: v })}
                />
                <ToggleRow
                  label="Skip draft PRs"
                  hint="Drafts get a Skipped agent cell instead of an analysis."
                  checked={settings.skipDrafts}
                  onChange={(v) => patch({ skipDrafts: v })}
                />

                <RepoOverrides settings={settings} onPatch={patch} />

                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Max changed files"
                    value={settings.maxChangedFiles}
                    onCommit={(v) => patch({ maxChangedFiles: v })}
                  />
                  <NumberField
                    label="Max diff lines"
                    value={settings.maxDiffLines}
                    onCommit={(v) => patch({ maxDiffLines: v })}
                  />
                  <NumberField
                    label="Finding cap"
                    value={settings.findingCap}
                    onCommit={(v) => patch({ findingCap: v })}
                  />
                  <NumberField
                    label="Nit cap"
                    value={settings.nitCap}
                    onCommit={(v) => patch({ nitCap: v })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Collapse findings below</Label>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={settings.severityThreshold}
                    onValueChange={(threshold) => {
                      if (
                        threshold === "blocker" ||
                        threshold === "risk" ||
                        threshold === "nit"
                      )
                        patch({ severityThreshold: threshold });
                    }}
                    className="justify-start"
                    aria-label="Severity threshold"
                  >
                    {(["blocker", "risk", "nit"] as const).map((threshold) => (
                      <ToggleGroupItem
                        key={threshold}
                        value={threshold}
                        className="text-xs font-mono"
                      >
                        {threshold === "nit"
                          ? "show everything"
                          : `${threshold}+`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="grid grid-cols-2 gap-3 items-end">
                  <NumberField
                    label="Daily cost ceiling (USD)"
                    value={settings.dailyCostUsd}
                    onCommit={(v) => patch({ dailyCostUsd: v })}
                  />
                  <div className="text-xs text-muted-foreground font-mono pb-2">
                    spent today: $
                    {runs.data?.spendTodayUsd.toFixed(2) ?? "0.00"} / $
                    {settings.dailyCostUsd.toFixed(2)}
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Tip: a{" "}
                  <code className="font-mono">.tandem/conventions.md</code> in a
                  repo is read into every run — house rules, known deprecations,
                  links to postmortems. It's the main quality lever per repo.
                </p>
              </>
            ) : null}
          </Card>

          {settings ? <PulseCard settings={settings} onPatch={patch} /> : null}
          {settings ? (
            <AutoApproveCard settings={settings} onPatch={patch} />
          ) : null}
          {settings ? <AgentsCard settings={settings} onPatch={patch} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Pulse: how the queue reads a cohort, and what the menu-bar feed serves.
 *
 * `rottingDays` is here rather than as a constant because it is a team norm,
 * not a fact — a repo shipping twice a day and one shipping monthly disagree
 * about when silence becomes a problem, and every "rotting" mark in the app
 * (rows, drawer, trend, menu bar) is drawn against this one number.
 */
function PulseCard({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const views = useSavedViews();
  const pulse = settings.pulse;
  const set = (p: Partial<TandemSettings["pulse"]>) =>
    onPatch({ pulse: { ...pulse, ...p } });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Pulse</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Whose court the ball is in, for every open PR. One definition drives
          the queue's pulse column, the breakdown, the header pill and the
          menu-bar feed — change it here and all five move together.
        </p>
      </div>

      <NumberField
        label="Rotting after (days idle)"
        value={pulse.rottingDays}
        onCommit={(v) => set({ rottingDays: Math.max(1, v) })}
      />

      <ToggleRow
        label="Keep a daily rollup"
        hint="Five integers per view per day in ~/.tandem/pulse.json — enough for the trend line in the breakdown, and nothing more. Off = no history is written."
        checked={pulse.journalEnabled}
        onChange={(v) => set({ journalEnabled: v })}
      />

      <div className="space-y-1.5">
        <Label className="text-xs">Menu-bar view</Label>
        <select
          value={pulse.menuViewId ?? ""}
          onChange={(e) => set({ menuViewId: e.target.value || null })}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All views, merged</option>
          {(views.data ?? []).map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Tandem serves its own xbar / SwiftBar plugin, so the menu bar inherits
          the team, this staleness line and the pulse rules instead of keeping a
          second copy of all three. Drop a file in your plugins folder
          containing:
        </p>
        <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto">
          {`#!/bin/sh\ncurl -s ${origin}/api/pulse.xbar`}
        </pre>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Append{" "}
          <code className="font-mono text-[10px]">?team=&lt;name&gt;</code> or{" "}
          <code className="font-mono text-[10px]">?group=author</code> to
          override per plugin. It is a read of the same queue — no extra token,
          no team list to maintain twice.
        </p>
      </div>
    </Card>
  );
}

function AutoApproveCard({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const aa = settings.autoApprove;
  const set = (p: Partial<TandemSettings["autoApprove"]>) =>
    onPatch({ autoApprove: { ...aa, ...p } });
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Auto-approve</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          The one unattended GitHub write Tandem can make, and only with this
          switch on. A run auto-approves ONLY when every gate holds: score at or
          above the threshold, zero blocker/risk findings, checks green (unless
          waived), not a draft, and no review of yours in progress on that PR.
        </p>
      </div>
      <ToggleRow
        label="Auto-approve qualifying PRs"
        hint="Off = the agent never writes to GitHub, ever."
        checked={aa.enabled}
        onChange={(v) => set({ enabled: v })}
      />
      <div className="grid grid-cols-2 gap-3 items-end">
        <NumberField
          label="Minimum score (0-100)"
          value={aa.minScore}
          onCommit={(v) => set({ minScore: Math.min(100, v) })}
        />
        <ToggleRow
          label="Require checks passing"
          checked={aa.requireChecksPassing}
          onChange={(v) => set({ requireChecksPassing: v })}
        />
      </div>
    </Card>
  );
}

function AgentsCard({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const [editingId, setEditingId] = useState(settings.defaultAgentId);
  const agent =
    settings.agents.find((a) => a.id === editingId) ?? settings.agents[0];

  const patchAgent = (patch: Partial<AgentProfile>) => {
    onPatch({
      agents: settings.agents.map((a) =>
        a.id === agent.id ? { ...a, ...patch } : a,
      ),
    });
  };

  const addAgent = () => {
    const id = crypto.randomUUID().slice(0, 8);
    const next: AgentProfile = {
      ...DEFAULT_AGENT,
      id,
      name: "New agent",
      description: undefined,
    };
    onPatch({ agents: [...settings.agents, next] });
    setEditingId(id);
  };

  const deleteAgent = () => {
    if (settings.agents.length <= 1) return;
    const remaining = settings.agents.filter((a) => a.id !== agent.id);
    onPatch({
      agents: remaining,
      defaultAgentId:
        settings.defaultAgentId === agent.id
          ? remaining[0].id
          : settings.defaultAgentId,
    });
    setEditingId(remaining[0].id);
  };

  if (!agent) return null;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Agents</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Reviewer profiles: each has its own models and prompt blocks, so
          agents can specialize (security sweep, test-coverage, API-contract…).
          The default runs automatically; any agent can run from the PR's rerun
          menu. Data blocks and the strict-JSON output contracts stay code-owned
          — findings that break the rules are dropped by validation regardless
          of prompt edits.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={agent.id}
          onValueChange={(id) => id && setEditingId(id)}
          aria-label="Agent profile"
        >
          {settings.agents.map((a) => (
            <ToggleGroupItem
              key={a.id}
              value={a.id}
              className="text-xs font-mono"
            >
              {a.name}
              {a.id === settings.defaultAgentId ? " ★" : ""}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button size="xs" variant="ghost" onClick={addAgent}>
          + agent
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Name"
          value={agent.name}
          onCommit={(v) => patchAgent({ name: v })}
        />
        <TextField
          label="Description"
          value={agent.description ?? ""}
          onCommit={(v) => patchAgent({ description: v || undefined })}
          allowEmpty
        />
      </div>

      <div className="grid grid-cols-4 gap-3">
        {(["orient", "analyze", "reconcile", "chat"] as const).map((pass) => (
          <TextField
            key={`${agent.id}-${pass}`}
            label={`${pass} model`}
            value={agent.models[pass]}
            onCommit={(v) =>
              patchAgent({ models: { ...agent.models, [pass]: v } })
            }
          />
        ))}
      </div>

      {(
        [
          [
            "rules",
            "Review rules",
            "Injected into the analyze and reconcile passes.",
          ],
          [
            "orient",
            "Pass 1 · orient",
            "Produces the review plan from PR metadata.",
          ],
          [
            "analyze",
            "Pass 2 · analyze",
            "Runs once per file cluster with the diffs in context.",
          ],
          [
            "reconcile",
            "Pass 3 · reconcile",
            "Dedupes, ranks, caps, scores. {findingCap} and {nitCap} interpolate from the caps above.",
          ],
          [
            "chat",
            "Chat",
            "How it talks to you in the pane, and how it proposes edits to its own findings and your staged comments. The action contract itself is code-owned.",
          ],
        ] as Array<[keyof PromptTexts, string, string]>
      ).map(([key, label, hint]) => (
        <PromptField
          key={`${agent.id}-${key}`}
          label={label}
          hint={hint}
          value={agent.prompts[key]}
          defaultValue={DEFAULT_PROMPTS[key]}
          onCommit={(value) =>
            patchAgent({ prompts: { ...agent.prompts, [key]: value } })
          }
        />
      ))}

      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={settings.defaultAgentId === agent.id}
          onClick={() => onPatch({ defaultAgentId: agent.id })}
        >
          Make default
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={settings.agents.length <= 1}
          onClick={deleteAgent}
        >
          Delete agent
        </Button>
      </div>
    </Card>
  );
}

function PromptField({
  label,
  hint,
  value,
  defaultValue,
  onCommit,
}: {
  label: string;
  hint: string;
  value: string;
  defaultValue: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim() ? draft : defaultValue;
    if (next !== value) onCommit(next);
    if (!draft.trim()) setDraft(defaultValue);
  };
  const isDefault = value === defaultValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
        <span className="flex-1" />
        {!isDefault ? (
          <>
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{ color: "var(--tandem-agent)" }}
            >
              customized
            </span>
            <Button
              size="3xs"
              variant="ghost"
              onClick={() => onCommit(defaultValue)}
            >
              reset to default
            </Button>
          </>
        ) : null}
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        className="min-h-28 text-xs font-mono leading-relaxed"
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {hint ? (
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(String(value));
  }
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== value)
      onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-8 text-sm font-mono"
        inputMode="numeric"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onCommit,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => {
    if ((draft.trim() || allowEmpty) && draft.trim() !== value)
      onCommit(draft.trim());
    else setDraft(value);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-8 text-sm font-mono"
      />
    </div>
  );
}

function RepoOverrides({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const [newRepo, setNewRepo] = useState("");
  const entries = Object.entries(settings.repos);

  const add = () => {
    const key = newRepo.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(key)) return;
    onPatch({
      repos: {
        ...settings.repos,
        [key]: { agentEnabled: !settings.agentEnabledByDefault },
      },
    });
    setNewRepo("");
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Per-repo overrides</Label>
      {entries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          None — every repo follows the default.
        </div>
      ) : null}
      {entries.map(([repo, { agentEnabled }]) => (
        <div key={repo} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs flex-1 truncate" title={repo}>
            {repo}
          </span>
          <Switch
            checked={agentEnabled}
            onCheckedChange={(v) =>
              onPatch({
                repos: { ...settings.repos, [repo]: { agentEnabled: v } },
              })
            }
          />
          <Button
            size="2xs"
            variant="ghost"
            onClick={() => {
              const next = { ...settings.repos };
              delete next[repo];
              onPatch({ repos: next });
            }}
          >
            remove
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newRepo}
          onChange={(e) => setNewRepo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="owner/repo"
          className="h-7 text-xs font-mono flex-1"
        />
        <Button size="xs" variant="outline" onClick={add}>
          Add override
        </Button>
      </div>
    </div>
  );
}
