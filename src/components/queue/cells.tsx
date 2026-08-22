import { Spinner, cn } from '@uipath/apollo-wind';
import { SKIP_REASON_LABEL, type AgentRun, type Severity } from '../../shared/agent-types';
import type { PullRequest } from '../../shared/review-types';
import { SeverityBadge } from '../agent/SeverityBadge';

export function ChecksCell({ pr }: { pr: PullRequest }) {
  if (pr.checkRollup === 'NONE') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
        <Dot className="bg-muted-foreground/40" /> no checks
      </span>
    );
  }
  const failing = pr.checkRuns.filter((c) => c.status === 'failure').length;
  const pending = pr.checkRuns.filter((c) => c.status === 'pending').length;
  const passing = pr.checkRuns.filter((c) => c.status === 'success').length;

  if (pr.checkRollup === 'FAILURE') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400 font-mono">
        <Dot className="bg-red-400" /> {failing || 1} failing
      </span>
    );
  }
  if (pr.checkRollup === 'PENDING') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-400 font-mono">
        <Dot className="bg-yellow-400" /> {pending || 1} pending
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
      <Dot className="bg-emerald-400" /> {passing || pr.checkRuns.length} passing
    </span>
  );
}

export function ReviewCell({ pr }: { pr: PullRequest }) {
  if (pr.isDraft) return <Pill className="border-muted-foreground/40 text-muted-foreground">draft</Pill>;
  switch (pr.reviewDecision) {
    case 'CHANGES_REQUESTED':
      return <Pill className="border-red-400/50 text-red-400">changes requested</Pill>;
    case 'APPROVED':
      return <Pill className="border-emerald-400/50 text-emerald-400">approved</Pill>;
    case 'REVIEW_REQUIRED':
      return <Pill className="border-yellow-400/50 text-yellow-400">awaiting you</Pill>;
    default:
      return <Pill className="border-muted-foreground/40 text-muted-foreground">—</Pill>;
  }
}

export function SizeCell({ pr }: { pr: PullRequest }) {
  return (
    <span className="text-xs font-mono whitespace-nowrap">
      <span className="text-emerald-400">+{compact(pr.additions)}</span> <span className="text-red-400">−{compact(pr.deletions)}</span>{' '}
      <span className="text-muted-foreground">· {pr.changedFiles}f</span>
    </span>
  );
}

const TALLY_ORDER: Severity[] = ['blocker', 'risk', 'nit', 'question', 'praise'];

// Four visual states (spec §3.1): Analyzing… (pulsing), findings tally,
// "Nothing to flag" (as legible as a finding — it earns the trust), and
// Skipped with its reason. Violet marks it all as machine-authored.
export function AgentCell({ run }: { run: AgentRun | undefined }) {
  if (!run) return <span className="text-xs text-muted-foreground/60 font-mono">—</span>;

  if (run.status === 'queued' || run.status === 'fetching' || run.status === 'analyzing') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-mono motion-safe:animate-pulse" style={{ color: 'var(--tandem-agent)' }}>
        <Spinner className="size-3" /> Analyzing…
      </span>
    );
  }

  if (run.status === 'skipped') {
    return (
      <span className="text-xs text-muted-foreground font-mono">
        Skipped · {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : ''}
      </span>
    );
  }

  if (run.status === 'failed') {
    return <span className="text-xs text-destructive font-mono">Run failed</span>;
  }

  if (run.status === 'stale') {
    return <span className="text-xs text-yellow-400/90 font-mono">Stale · new commits</span>;
  }

  const triage = run.findings.filter((f) => f.state !== 'dismissed');
  if (triage.length === 0) {
    return (
      <span className="text-xs text-muted-foreground font-mono">
        Nothing to flag <span className="text-muted-foreground/60">· safe to review fast</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs font-mono" style={{ color: 'var(--tandem-agent)' }}>
        {triage.length} finding{triage.length === 1 ? '' : 's'} ready
      </span>
      <span className="flex gap-1 flex-wrap">
        {TALLY_ORDER.map((severity) => (
          <SeverityBadge key={severity} severity={severity} count={triage.filter((f) => f.severity === severity).length} />
        ))}
      </span>
    </span>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function Dot({ className }: { className?: string }) {
  return <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', className)} />;
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-block border rounded px-1.5 py-0.5 text-[11px] font-mono whitespace-nowrap', className)}>{children}</span>;
}
