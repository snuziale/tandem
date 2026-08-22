import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, cn, toast } from '@uipath/apollo-wind';
import { startRun } from '../../api/runs';
import { SKIP_REASON_LABEL, type AgentRun, type Finding, type RunEvent, type Severity } from '../../shared/agent-types';
import type { TandemSettings } from '../../shared/settings-types';
import { useUiStore } from '../../state/uiStore';
import { SeverityBadge } from './SeverityBadge';

type Props = {
  prId: string;
  run: AgentRun | undefined;
  progress: RunEvent | null;
  settings: TandemSettings | undefined;
  onSelectFinding: (finding: Finding) => void;
};

const SEVERITY_ORDER: Severity[] = ['blocker', 'risk', 'nit', 'question', 'praise'];

// The right-hand agent pane (spec §3.2): run status, prose summary, severity
// tally, findings grouped Must resolve / Worth raising / Nits.
export function AgentPane({ prId, run, progress, settings, onSelectFinding }: Props) {
  const queryClient = useQueryClient();
  const focusedFindingId = useUiStore((s) => s.focusedFindingId);
  const [showNits, setShowNits] = useState(false);

  const rerun = useMutation({
    mutationFn: () => startRun(prId, true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs'] }),
    onError: (e) => toast.error('Could not start run', { description: e instanceof Error ? e.message : undefined }),
  });

  const triage = (run?.findings ?? []).filter((f) => f.state === 'proposed' || f.state === 'edited');
  const threshold = settings?.severityThreshold ?? 'risk';
  const collapsed = triage.filter((f) => belowThreshold(f.severity, threshold));
  const visible = triage.filter((f) => !belowThreshold(f.severity, threshold));
  const mustResolve = visible.filter((f) => f.severity === 'blocker');
  const worthRaising = visible.filter((f) => f.severity !== 'blocker');

  return (
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border">
        <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--tandem-agent)' }}>
          ● agent
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={rerun.isPending || isActive(run)} onClick={() => rerun.mutate()}>
          rerun <span className="ml-1 opacity-60">r</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <StatusCard run={run} progress={progress} onStart={() => rerun.mutate()} starting={rerun.isPending} />

        {run?.status === 'ready' ? (
          <>
            {run.summary ? <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground leading-relaxed">{run.summary}</p> : null}

            {triage.length > 0 ? (
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {SEVERITY_ORDER.map((severity) => (
                  <SeverityBadge key={severity} severity={severity} count={triage.filter((f) => f.severity === severity).length} />
                ))}
              </div>
            ) : (
              <div className="px-3 pb-3 text-sm">
                <div className="font-medium">Nothing to flag</div>
                <div className="text-muted-foreground text-xs mt-0.5">The agent read the diff and has nothing worth your time.</div>
              </div>
            )}

            <FindingGroup label="must resolve" findings={mustResolve} focusedFindingId={focusedFindingId} onSelect={onSelectFinding} />
            <FindingGroup label="worth raising" findings={worthRaising} focusedFindingId={focusedFindingId} onSelect={onSelectFinding} />

            {collapsed.length > 0 ? (
              <div className="px-3 py-2 border-t border-border/60">
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNits((v) => !v)}
                >
                  nits · {collapsed.length} hidden · {showNits ? 'hide' : 'show'}
                </button>
                {showNits ? (
                  <div className="mt-1">
                    {collapsed.map((f) => (
                      <FindingRow key={f.id} finding={f} focused={f.id === focusedFindingId} onSelect={onSelectFinding} />
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Nits stay collapsed below your <span className="font-mono">{threshold}</span> threshold. Change it in settings.
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function isActive(run: AgentRun | undefined): boolean {
  return !!run && (run.status === 'queued' || run.status === 'fetching' || run.status === 'analyzing');
}

function belowThreshold(severity: Severity, threshold: 'blocker' | 'risk' | 'nit'): boolean {
  if (threshold === 'nit') return false;
  if (severity === 'nit' || severity === 'praise') return true;
  if (threshold === 'blocker') return severity !== 'blocker';
  return false;
}

function StatusCard({ run, progress, onStart, starting }: { run: AgentRun | undefined; progress: RunEvent | null; onStart: () => void; starting: boolean }) {
  if (!run || run.status === 'stale' || run.status === 'failed') {
    return (
      <div className="px-3 py-2 space-y-1.5">
        {run?.status === 'stale' ? <div className="text-xs text-yellow-400 font-mono">new commits — findings below are stale</div> : null}
        {run?.status === 'failed' ? <div className="text-xs text-destructive font-mono break-words">run failed: {run.error}</div> : null}
        <Button size="sm" variant="outline" onClick={onStart} disabled={starting}>
          {starting ? 'Starting…' : run ? 'Rerun agent' : 'Run agent'}
        </Button>
      </div>
    );
  }

  if (isActive(run)) {
    const label =
      progress?.type === 'pass' ? progress.label : progress?.type === 'status' ? (progress.detail ?? progress.status) : run.status;
    return (
      <div className="px-3 py-2 flex items-center gap-2 text-sm" style={{ color: 'var(--tandem-agent)' }}>
        <Spinner className="size-3.5" /> Analyzing… <span className="text-muted-foreground text-xs font-mono">{label}</span>
      </div>
    );
  }

  if (run.status === 'skipped') {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        Skipped · {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : 'not analyzed'}
      </div>
    );
  }

  // ready
  const duration = run.startedAt && run.finishedAt ? `${Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}s` : null;
  const cost = run.costUsd > 0 ? `$${run.costUsd.toFixed(2)}` : `${Math.round(run.tokensUsed / 1000)}k tok`;
  return (
    <div className="px-3 py-2 flex items-center gap-2 text-xs font-mono text-muted-foreground">
      <span className="text-emerald-400">● review ready</span>
      <span className="flex-1" />
      <span>
        {run.headSha.slice(0, 7)}
        {duration ? ` · ${duration}` : ''} · {cost}
      </span>
    </div>
  );
}

function FindingGroup({
  label,
  findings,
  focusedFindingId,
  onSelect,
}: {
  label: string;
  findings: Finding[];
  focusedFindingId: string | null;
  onSelect: (finding: Finding) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <div className="px-3 py-2 border-t border-border/60">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">{label}</div>
      {findings.map((f) => (
        <FindingRow key={f.id} finding={f} focused={f.id === focusedFindingId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function FindingRow({ finding, focused, onSelect }: { finding: Finding; focused: boolean; onSelect: (finding: Finding) => void }) {
  return (
    <button
      type="button"
      data-finding-row={finding.id}
      onClick={() => onSelect(finding)}
      className={cn('w-full text-left rounded px-1.5 py-1.5 hover:bg-accent/40', focused && 'bg-accent/60')}
    >
      <div className="flex items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <span className="text-xs truncate flex-1">{finding.title}</span>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
        {finding.path.split('/').pop()}:{finding.endLine} · {finding.category}
        {finding.suggestion !== undefined ? ' · has suggestion' : ''}
      </div>
    </button>
  );
}
