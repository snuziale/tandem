import { useEffect } from 'react';
import { Skeleton, cn } from '@uipath/apollo-wind';
import { useUiStore } from '../../state/uiStore';
import type { PullRequest } from '../../shared/review-types';
import { openPrExternal } from '../../hooks/queueActions';
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

  // Publish the visible rows for the keyboard handlers; clamp a focus that no
  // longer exists (row left the view on refetch).
  useEffect(() => {
    const refs = (rows ?? []).map((pr) => ({ prId: pr.prId, url: pr.url }));
    setQueueRows(refs);
    const { focusedPrId: focused } = useUiStore.getState();
    if (focused && !refs.some((r) => r.prId === focused)) setFocusedPr(refs[0]?.prId ?? null);
  }, [rows, setQueueRows, setFocusedPr]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn(QUEUE_GRID, 'py-1.5 border-b border-border sticky top-0 bg-background z-10')}>
        {['pull request', 'checks', 'review', 'size', 'agent'].map((label) => (
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
            focused={pr.prId === focusedPrId}
            onFocus={() => setFocusedPr(pr.prId)}
            // In-app detail lands in M2; until then a row opens on GitHub.
            onOpen={() => openPrExternal(pr.url)}
          />
        ))
      )}
    </div>
  );
}
