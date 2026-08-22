import { Badge } from '@uipath/apollo-wind';
import type { Severity } from '../../shared/agent-types';

// Severity maps onto apollo Badge's semantic variants — readable chips in both
// themes. Violet is provenance — it marks WHO wrote something, never how bad.
const VARIANT: Record<Severity, 'error' | 'warning' | 'secondary' | 'info' | 'success'> = {
  blocker: 'error',
  risk: 'warning',
  nit: 'secondary',
  question: 'info',
  praise: 'success',
};

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  if (count === 0) return null;
  return (
    <Badge variant={VARIANT[severity]} className="whitespace-nowrap">
      {count !== undefined ? `${count} ` : ''}
      {severity}
      {count !== undefined && count > 1 ? 's' : ''}
    </Badge>
  );
}
