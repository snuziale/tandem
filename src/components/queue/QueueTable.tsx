import { useEffect, useMemo } from "react";
import { Button, Skeleton, cn } from "@uipath/apollo-wind";
import { useUiStore } from "../../state/uiStore";
import type { PulseOptions } from "../../shared/pulse";
import { hasUnseenChanges, type PullRequest } from "../../shared/review-types";
import { openPrDetail } from "../../hooks/useKeyboardNav";
import { runFor, useAgentRuns } from "../../hooks/useAgentRuns";
import { useSeen } from "../../hooks/useSeen";
import { useNow } from "../../hooks/useNow";
import { QUEUE_GRID, QueueRow } from "./QueueRow";

// Trailing empty label: the hover actions own the last column, and a heading
// over two buttons that are invisible most of the time is noise.
const COLUMNS = [
  "pull request",
  "pulse",
  "checks",
  "review",
  "size",
  "updated",
  "agent",
  "",
];

type Props = {
  rows: PullRequest[] | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Per-view search failure from the queue response (other views may be fine). */
  viewError?: string;
  /**
   * Set only when a stats facet is narrowing a NON-empty view. Without it an
   * empty table blames the view's query, which is a lie when the view matched
   * plenty and the filter is what emptied it — and leaves no way back.
   */
  filteredBy?: { label: string; onClear: () => void };
  pulseOpts: PulseOptions;
};

export function QueueTable({
  rows,
  isLoading,
  error,
  viewError,
  filteredBy,
  pulseOpts,
}: Props) {
  const focusedPrId = useUiStore((s) => s.focusedPrId);
  const setFocusedPr = useUiStore((s) => s.setFocusedPr);
  const setQueueRows = useUiStore((s) => s.setQueueRows);
  const runs = useAgentRuns();
  const seen = useSeen();
  const now = useNow();

  // One shared scale for the size column's churn bars: the biggest PR on
  // screen fills its track and every other bar is read against it.
  const maxChurn = useMemo(
    () =>
      (rows ?? []).reduce(
        (max, pr) => Math.max(max, pr.additions + pr.deletions),
        0,
      ),
    [rows],
  );

  // Publish the visible rows for the keyboard handlers (including whether the
  // agent found a blocker — the 'a' guard reads it); clamp a focus that no
  // longer exists (row left the view on refetch).
  const runsData = runs.data;
  useEffect(() => {
    const refs = (rows ?? []).map((pr) => {
      const run = runFor(runsData, pr.prId, pr.headSha);
      const blocker =
        run?.status === "ready"
          ? run.findings.find(
              (f) => f.severity === "blocker" && f.state !== "dismissed",
            )
          : undefined;
      return { prId: pr.prId, url: pr.url, blockerTitle: blocker?.title };
    });
    setQueueRows(refs);
    const { focusedPrId: focused } = useUiStore.getState();
    if (focused && !refs.some((r) => r.prId === focused))
      setFocusedPr(refs[0]?.prId ?? null);
  }, [rows, runsData, setQueueRows, setFocusedPr]);

  const renderRow = (pr: PullRequest) => (
    <QueueRow
      key={pr.prId}
      pr={pr}
      run={runFor(runs.data, pr.prId, pr.headSha)}
      unseen={hasUnseenChanges(seen.data, pr)}
      maxChurn={maxChurn}
      pulseOpts={pulseOpts}
      now={now}
      focused={pr.prId === focusedPrId}
      onFocus={() => setFocusedPr(pr.prId)}
      onOpen={() => openPrDetail(pr.prId)}
    />
  );

  return (
    // Horizontal scroll floor: below ~1240px the table scrolls sideways
    // instead of crushing the title column into invisibility.
    <div className="flex-1 overflow-auto">
      <div className="min-w-[1240px]">
        <div
          className={cn(
            QUEUE_GRID,
            "h-8 border-b border-border sticky top-0 bg-background z-10",
          )}
        >
          {COLUMNS.map((label) => (
            <span
              key={label}
              className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono"
            >
              {label}
            </span>
          ))}
        </div>

        {error ? (
          <Placeholder tone="error">
            Queue failed to load: {error.message}
          </Placeholder>
        ) : viewError ? (
          <Placeholder tone="error">
            This view's search failed: {viewError}
          </Placeholder>
        ) : isLoading ? (
          <div className="px-4 py-3 space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          filteredBy ? (
            <Placeholder>
              No PR in this view matches{" "}
              <span className="font-mono text-foreground">
                {filteredBy.label}
              </span>
              .
              <div className="mt-3">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={filteredBy.onClear}
                >
                  Clear filter
                </Button>
              </div>
            </Placeholder>
          ) : (
            <Placeholder>
              Nothing here — this view's query matched no open PRs.
            </Placeholder>
          )
        ) : (
          rows.map(renderRow)
        )}
      </div>
    </div>
  );
}

/** Error / empty state, centred in the same gutter as the rows. */
function Placeholder({
  tone,
  children,
}: {
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-4 py-16 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}
