import { cn } from '@uipath/apollo-wind';
import type { PullRequest } from '../../shared/review-types';

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

// Placeholder until agent runs land (M4). Violet is reserved for real agent
// output — the placeholder stays neutral.
export function AgentCell() {
  return <span className="text-xs text-muted-foreground/60 font-mono">—</span>;
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
