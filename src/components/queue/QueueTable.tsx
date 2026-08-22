import { useEffect } from 'react';
import { Skeleton, cn } from '@uipath/apollo-wind';
import { useUiStore } from '../../state/uiStore';
import type { PullRequest } from '../../shared/review-types';
import { openPrDetail } from '../../hooks/useKeyboardNav';
import { runFor, useAgentRuns } from '../../hooks/useAgentRuns';
import { hasUnseenChanges, useSeen } from '../../hooks/useSeen';
import { useNow } from '../../hooks/useNow';
import { QUEUE_GRID, QueueRow } from './QueueRow';

type Props = {
  rows: PullRequest[] | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Per-view search failure from the queue response (other views may be fine). */
  viewError?: string;
};

export function QueueTable({ rows, isLoading, error, viewError }: Props) {
  const focusedPrId = useUiStore((s) => s.focusedPrId);
  const setFocusedPr = useUiStore((s) => s.setFocusedPr);
  const setQueueRows = useUiStore((s) => s.setQueueRows);
  const runs = useAgentRuns();
  const seen = useSeen();
  const now = useNow();

  // Publish the visible rows for the keyboard handlers (including whether the
  // agent found a blocker — the 'a' guard reads it); clamp a focus that no
  // longer exists (row left the view on refetch).
  const runsData = runs.data;
  useEffect(() => {
    const refs = (rows ?? []).map((pr) => {
      const run = runFor(runsData, pr.prId, pr.headSha);
      const blocker = run?.status === 'ready' ? run.findings.find((f) => f.severity === 'blocker' && f.state !== 'dismissed') : undefined;
      return { prId: pr.prId, url: pr.url, blockerTitle: blocker?.title };
    });
    setQueueRows(refs);
    const { focusedPrId: focused } = useUiStore.getState();
    if (focused && !refs.some((r) => r.prId === focused)) setFocusedPr(refs[0]?.prId ?? null);
  }, [rows, runsData, setQueueRows, setFocusedPr]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn(QUEUE_GRID, 'py-1.5 border-b border-border sticky top-0 bg-background z-10')}>
        {['pull request', 'checks', 'review', 'size', 'updated', 'agent'].map((label) => (
          <span key={label} className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            {label}
          </span>
        ))}
      </div>

      {error ? (
        <div className="px-4 py-8 text-sm text-destructive">
          Queue failed to load: {error.message}
        </div>
      ) : viewError ? (
        <div className="px-4 py-8 text-sm text-destructive">This view's search failed: {viewError}</div>
      ) : isLoading ? (
        <div className="px-4 py-3 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">Nothing here — this view's query matched no open PRs.</div>
      ) : (
        rows.map((pr) => (
          <QueueRow
            key={pr.prId}
            pr={pr}
            run={runFor(runs.data, pr.prId, pr.headSha)}
            unseen={hasUnseenChanges(seen.data, pr)}
            now={now}
            focused={pr.prId === focusedPrId}
            onFocus={() => setFocusedPr(pr.prId)}
            onOpen={() => openPrDetail(pr.prId)}
          />
        ))
      )}
    </div>
  );
}
