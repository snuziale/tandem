import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Label, Switch, ToggleGroup, ToggleGroupItem } from '@uipath/apollo-wind';
import { ArrowLeft } from 'lucide-react';
import { fetchAgentHealth } from '../../api/runs';
import { useAgentRuns } from '../../hooks/useAgentRuns';
import { useConfigStatus } from '../../hooks/useConfigStatus';
import { useSaveSettings, useSettings } from '../../hooks/useSettings';
import { hasOpenDialog, isTypingTarget } from '../../keyboard/target';
import { navigate } from '../../routes';
import type { TandemSettings } from '../../shared/settings-types';
import { TopBar } from '../layout/TopBar';
import { CredentialsForm } from '../setup/CredentialsForm';

export function SettingsView() {
  const status = useConfigStatus();
  const settingsQuery = useSettings();
  const save = useSaveSettings();
  const runs = useAgentRuns();
  const health = useQuery({ queryKey: ['agent', 'health'], queryFn: fetchAgentHealth, staleTime: 60_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasOpenDialog() && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigate({ name: 'queue' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const settings = settingsQuery.data;
  const patch = (p: Partial<TandemSettings>) => save.mutate(p);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => navigate({ name: 'queue' })}>
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
                      Reviews post as <span className="font-mono text-foreground">@{status.data.login}</span> ·{' '}
                    </>
                  ) : null}
                  stored at <code className="font-mono text-[11px]">{status.data.configPath}</code>
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
                {health.data?.available ? `claude ${health.data.version ?? ''}` : health.data ? 'claude CLI unavailable' : ''}
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
                  <NumberField label="Max changed files" value={settings.maxChangedFiles} onCommit={(v) => patch({ maxChangedFiles: v })} />
                  <NumberField label="Max diff lines" value={settings.maxDiffLines} onCommit={(v) => patch({ maxDiffLines: v })} />
                  <NumberField label="Finding cap" value={settings.findingCap} onCommit={(v) => patch({ findingCap: v })} />
                  <NumberField label="Nit cap" value={settings.nitCap} onCommit={(v) => patch({ nitCap: v })} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Collapse findings below</Label>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={settings.severityThreshold}
                    onValueChange={(threshold) => {
                      if (threshold === 'blocker' || threshold === 'risk' || threshold === 'nit') patch({ severityThreshold: threshold });
                    }}
                    className="justify-start"
                    aria-label="Severity threshold"
                  >
                    {(['blocker', 'risk', 'nit'] as const).map((threshold) => (
                      <ToggleGroupItem key={threshold} value={threshold} className="text-xs font-mono">
                        {threshold === 'nit' ? 'show everything' : `${threshold}+`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="grid grid-cols-2 gap-3 items-end">
                  <NumberField label="Daily cost ceiling (USD)" value={settings.dailyCostUsd} onCommit={(v) => patch({ dailyCostUsd: v })} />
                  <div className="text-xs text-muted-foreground font-mono pb-2">
                    spent today: ${runs.data?.spendTodayUsd.toFixed(2) ?? '0.00'} / ${settings.dailyCostUsd.toFixed(2)}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {(['orient', 'analyze', 'reconcile'] as const).map((pass) => (
                    <TextField
                      key={pass}
                      label={`${pass} model`}
                      value={settings.models[pass]}
                      onCommit={(v) => patch({ models: { ...settings.models, [pass]: v } })}
                    />
                  ))}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Tip: a <code className="font-mono">.tandem/conventions.md</code> in a repo is read into every run — house rules,
                  known deprecations, links to postmortems. It's the main quality lever per repo.
                </p>
              </>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(String(value));
  }
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== value) onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8 text-sm font-mono"
        inputMode="numeric"
      />
    </div>
  );
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() && draft !== value) onCommit(draft.trim());
    else setDraft(value);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8 text-sm font-mono"
      />
    </div>
  );
}

function RepoOverrides({ settings, onPatch }: { settings: TandemSettings; onPatch: (p: Partial<TandemSettings>) => void }) {
  const [newRepo, setNewRepo] = useState('');
  const entries = Object.entries(settings.repos);

  const add = () => {
    const key = newRepo.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(key)) return;
    onPatch({ repos: { ...settings.repos, [key]: { agentEnabled: !settings.agentEnabledByDefault } } });
    setNewRepo('');
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Per-repo overrides</Label>
      {entries.length === 0 ? <div className="text-[11px] text-muted-foreground">None — every repo follows the default.</div> : null}
      {entries.map(([repo, { agentEnabled }]) => (
        <div key={repo} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs flex-1 truncate" title={repo}>
            {repo}
          </span>
          <Switch
            checked={agentEnabled}
            onCheckedChange={(v) => onPatch({ repos: { ...settings.repos, [repo]: { agentEnabled: v } } })}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
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
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="owner/repo"
          className="h-7 text-xs font-mono flex-1"
        />
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={add}>
          Add override
        </Button>
      </div>
    </div>
  );
}
