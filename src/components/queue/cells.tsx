import { Badge, Spinner, cn } from '@uipath/apollo-wind';
import { SKIP_REASON_LABEL, type AgentRun, type Severity } from '../../shared/agent-types';
import type { PullRequest } from '../../shared/review-types';
import { relativeAge } from '../../utils/time';
import { SeverityBadge } from '../agent/SeverityBadge';

export function ChecksCell({ pr }: { pr: PullRequest }) {
  if (pr.checkRollup === 'NONE') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Dot className="bg-muted-foreground/40" /> no checks
      </span>
    );
  }
  const failing = pr.checkRuns.filter((c) => c.status === 'failure').length;
  const pending = pr.checkRuns.filter((c) => c.status === 'pending').length;
  const passing = pr.checkRuns.filter((c) => c.status === 'success').length;

  if (pr.checkRollup === 'FAILURE') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-500 dark:text-red-400">
        <Dot className="bg-red-500 dark:bg-red-400" /> {failing || 1} failing
      </span>
    );
  }
  if (pr.checkRollup === 'PENDING') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
        <Dot className="bg-yellow-500 dark:bg-yellow-400" /> {pending || 1} pending
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Dot className="bg-emerald-500 dark:bg-emerald-400" /> {passing || pr.checkRuns.length} passing
    </span>
  );
}

export function ReviewCell({ pr }: { pr: PullRequest }) {
  if (pr.isDraft) {
    return (
      <Badge variant="outline" className="border-dashed text-muted-foreground">
        Draft
      </Badge>
    );
  }
  switch (pr.reviewDecision) {
    case 'CHANGES_REQUESTED':
      return <Badge variant="error">Changes requested</Badge>;
    case 'APPROVED':
      return <Badge variant="success">Approved</Badge>;
    case 'REVIEW_REQUIRED':
      return <Badge variant="warning">Awaiting you</Badge>;
    default:
      return <Badge variant="secondary">No review</Badge>;
  }
}

export function SizeCell({ pr }: { pr: PullRequest }) {
  return (
    <span className="text-xs font-mono whitespace-nowrap">
      <span className="text-emerald-600 dark:text-emerald-400">+{compact(pr.additions)}</span>{' '}
      <span className="text-red-500 dark:text-red-400">−{compact(pr.deletions)}</span>{' '}
      <span className="text-muted-foreground">· {pr.changedFiles}f</span>
    </span>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Updated + created ages; the updated age colors as the PR goes stale.
 * `now` comes from the table's useNow ticker (render purity). */
export function AgeCell({ pr, now }: { pr: PullRequest; now: number }) {
  const idleDays = (now - new Date(pr.updatedAt).getTime()) / DAY;
  return (
    <span className="flex flex-col gap-0.5 whitespace-nowrap">
      <span
        className={cn(
          'text-xs',
          idleDays > 21
            ? 'text-red-500 dark:text-red-400 font-medium'
            : idleDays > 7
              ? 'text-yellow-600 dark:text-yellow-400 font-medium'
              : 'text-foreground/80'
        )}
        title={`last updated ${new Date(pr.updatedAt).toLocaleString()}`}
      >
        {relativeAge(pr.updatedAt, now)}
      </span>
      <span className="text-[10px] text-muted-foreground" title={`opened ${new Date(pr.createdAt).toLocaleString()}`}>
        opened {relativeAge(pr.createdAt, now)}
      </span>
    </span>
  );
}

const TALLY_ORDER: Severity[] = ['blocker', 'risk', 'nit', 'question', 'praise'];

// Four visual states (spec §3.1): Analyzing… (pulsing), findings tally,
// "Nothing to flag" (as legible as a finding — it earns the trust), and
// Skipped with its reason. Violet marks it all as machine-authored.
export function AgentCell({ run }: { run: AgentRun | undefined }) {
  if (!run) return <span className="text-xs text-muted-foreground/60">—</span>;

  if (run.status === 'queued' || run.status === 'fetching' || run.status === 'analyzing') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium motion-safe:animate-pulse" style={{ color: 'var(--tandem-agent)' }}>
        <Spinner className="size-3" /> Analyzing…
      </span>
    );
  }

  if (run.status === 'skipped') {
    return (
      <span className="text-xs text-muted-foreground">Skipped · {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : ''}</span>
    );
  }

  if (run.status === 'failed') {
    return <span className="text-xs font-medium text-red-500 dark:text-red-400">Run failed</span>;
  }

  if (run.status === 'stale') {
    return <span className="text-xs text-yellow-600 dark:text-yellow-400">Stale · new commits</span>;
  }

  const triage = run.findings.filter((f) => f.state !== 'dismissed');
  if (triage.length === 0) {
    return (
      <span className="text-xs">
        <span className="font-medium">Nothing to flag</span> <span className="text-muted-foreground">· safe to review fast</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium" style={{ color: 'var(--tandem-agent)' }}>
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
