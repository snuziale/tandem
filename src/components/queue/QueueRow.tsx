import { useQueryClient } from '@tanstack/react-query';
import { Button, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger, cn } from '@uipath/apollo-wind';
import { Check, ExternalLink } from 'lucide-react';
import { approvePrAction, openPrExternal } from '../../hooks/queueActions';
import type { AgentRun } from '../../shared/agent-types';
import type { PullRequest } from '../../shared/review-types';
import { AgeCell, AgentCell, ChecksCell, ReviewCell, SizeCell } from './cells';

export const QUEUE_GRID = 'grid grid-cols-[minmax(0,1fr)_95px_140px_135px_95px_240px] gap-3 items-center px-4';

type Props = {
  pr: PullRequest;
  run: AgentRun | undefined;
  /** The PR changed since the reviewer last opened it here (or never opened). */
  unseen: boolean;
  now: number;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
};

export function QueueRow({ pr, run, unseen, now, focused, onFocus, onOpen }: Props) {
  const queryClient = useQueryClient();
  // Guard rail, not a block (spec §3.1): quick approve refuses while the agent
  // has an undismissed blocker; the tooltip names it, shift+A overrides.
  const blocker = run?.status === 'ready' ? run.findings.find((f) => f.severity === 'blocker' && f.state !== 'dismissed') : undefined;

  return (
    <div
      data-pr-row={pr.prId}
      onClick={onOpen}
      onMouseEnter={onFocus}
      className={cn(
        // Fixed height — content clips rather than ever growing the row.
        'group h-14 overflow-hidden border-b border-border/60 cursor-pointer relative',
        QUEUE_GRID,
        focused ? 'bg-accent/60 shadow-[inset_2px_0_0_0_var(--color-primary)]' : 'hover:bg-accent/30',
        // Drafts read as background noise until they're ready for review.
        pr.isDraft && 'opacity-55'
      )}
    >
      <div className="min-w-0">
        <div className={cn('text-sm truncate flex items-center gap-1.5', unseen && 'font-semibold')} title={pr.title}>
          {unseen ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 shrink-0" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>Changed since you last opened it</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          ) : null}
          <span className="truncate">{pr.title}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          <span className="font-mono">#{pr.number}</span> · {pr.repo} · @{pr.author} ·{' '}
          <span className="font-mono">
            {pr.headRef} → {pr.baseRef}
          </span>
        </div>
      </div>
      <ChecksCell pr={pr} />
      <ReviewCell pr={pr} />
      <SizeCell pr={pr} />
      <AgeCell pr={pr} now={now} />
      <div className="flex items-center justify-between gap-2 min-w-0">
        <AgentCell run={run} />
        {/* invisible (not hidden): the actions always occupy their space, so
            hovering never changes the row height. */}
        <div className="invisible group-hover:visible flex items-center gap-1 shrink-0">
          <Button
            size="2xs"
            variant="outline"
            disabled={pr.isDraft || !!blocker}
            title={blocker ? `Agent found a blocker: ${blocker.title} (shift+A overrides)` : undefined}
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
    </div>
  );
}
