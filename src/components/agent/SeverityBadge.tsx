import { cn } from '@uipath/apollo-wind';
import type { Severity } from '../../shared/agent-types';

// Severity keeps its own colors (red/yellow/etc). Violet is provenance — it
// marks WHO wrote something, never how bad it is.
const STYLES: Record<Severity, string> = {
  blocker: 'border-red-400/60 text-red-400 bg-red-400/10',
  risk: 'border-yellow-400/60 text-yellow-400 bg-yellow-400/10',
  nit: 'border-muted-foreground/40 text-muted-foreground',
  question: 'border-blue-400/60 text-blue-400',
  praise: 'border-emerald-400/60 text-emerald-400',
};

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  if (count === 0) return null;
  return (
    <span className={cn('inline-block border rounded px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap', STYLES[severity])}>
      {count !== undefined ? `${count} ` : ''}
      {severity}
      {count !== undefined && count > 1 ? 's' : ''}
    </span>
  );
}
