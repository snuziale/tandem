import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import { Check, ExternalLink } from "lucide-react";
import { approvePrAction, openPrExternal } from "../../actions/queue";
import type { AgentRun } from "../../shared/agent-types";
import type { PulseOptions } from "../../shared/pulse";
import type { PullRequest } from "../../shared/review-types";
import {
  AgeCell,
  AgentCell,
  ChecksCell,
  PulseCell,
  ReviewCell,
  SignalsCell,
  SizeCell,
} from "./cells";

// Pulse sits second, right after the title: it is the column that says whether
// the row is yours to act on, and everything to its right is the evidence.
//
// The hover actions get their OWN trailing column rather than sharing the
// agent cell. They used to sit beside the agent content behind a
// `justify-between`, which meant the widest agent state (a findings tally plus
// a score meter plus severity chips) was competing for width with two buttons
// that are invisible most of the time — so the agent text truncated on hover-
// capable widths for no reason. Separate columns, no competition.
export const QUEUE_GRID =
  "grid grid-cols-[minmax(0,1fr)_120px_95px_175px_125px_95px_195px_104px] gap-3 items-center px-4";

type Props = {
  pr: PullRequest;
  run: AgentRun | undefined;
  /** The PR changed since the reviewer last opened it here (or never opened). */
  unseen: boolean;
  /** Largest churn among the rows on screen — the churn bar's shared scale. */
  maxChurn: number;
  /** Viewer + staleness line, so the pulse cell means the same thing here as
   * in the drawer and the menu bar. */
  pulseOpts: PulseOptions;
  now: number;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
};

export function QueueRow({
  pr,
  run,
  unseen,
  maxChurn,
  pulseOpts,
  now,
  focused,
  onFocus,
  onOpen,
}: Props) {
  const queryClient = useQueryClient();
  // Guard rail, not a block (spec §3.1): quick approve refuses while the agent
  // has an undismissed blocker; the tooltip names it, shift+A overrides.
  const blocker =
    run?.status === "ready"
      ? run.findings.find(
          (f) => f.severity === "blocker" && f.state !== "dismissed",
        )
      : undefined;

  return (
    <div
      data-pr-row={pr.prId}
      onClick={onOpen}
      onMouseEnter={onFocus}
      className={cn(
        // Fixed height — content clips rather than ever growing the row.
        "group h-14 overflow-hidden border-b border-border/60 cursor-pointer relative",
        QUEUE_GRID,
        focused
          ? "bg-accent/60 shadow-[inset_2px_0_0_0_var(--color-primary)]"
          : "hover:bg-accent/30",
        // Drafts read as background noise until they're ready for review.
        pr.isDraft && "opacity-55",
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm truncate flex items-center gap-1.5",
            unseen && "font-semibold",
          )}
          title={pr.title}
        >
          {unseen ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 shrink-0" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>
                  Changed since you last opened it
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          ) : null}
          <span className="truncate">{pr.title}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          <span className="font-mono">#{pr.number}</span> · {pr.repo} · @
          {pr.author} ·{" "}
          <span className="font-mono">
            {pr.headRef} → {pr.baseRef}
          </span>
        </div>
      </div>
      <PulseCell pr={pr} opts={pulseOpts} />
      <ChecksCell pr={pr} />
      {/* Verdict over its evidence, and the second line is ALWAYS reserved
          (SignalsCell renders an empty track when a PR has no reviews or
          comments yet). Without that the badge sat centred on one-line rows
          and high on two-line rows, so the column's most-scanned element
          drifted up and down as you moved through the queue. */}
      <div className="flex flex-col gap-1 min-w-0 items-start">
        <ReviewCell pr={pr} />
        <SignalsCell pr={pr} />
      </div>
      <SizeCell pr={pr} maxChurn={maxChurn} />
      <AgeCell pr={pr} now={now} />
      <AgentCell prId={pr.prId} run={run} />
      {/* invisible (not hidden): the actions always occupy their column, so
          hovering never reflows the row. */}
      <div className="invisible group-hover:visible flex items-center justify-end gap-1">
        <Button
          size="2xs"
          variant="outline"
          disabled={pr.isDraft || !!blocker}
          title={
            blocker
              ? `Agent found a blocker: ${blocker.title} (shift+A overrides)`
              : undefined
          }
          onClick={(e) => {
            e.stopPropagation();
            void approvePrAction(queryClient, pr.prId);
          }}
        >
          <Check /> Approve
        </Button>
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label="Open on GitHub"
          onClick={(e) => {
            e.stopPropagation();
            openPrExternal(pr.url);
          }}
        >
          <ExternalLink />
        </Button>
      </div>
    </div>
  );
}
