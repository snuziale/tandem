import { useQueryClient } from '@tanstack/react-query';
import { Button, cn } from '@uipath/apollo-wind';
import { Check, ExternalLink } from 'lucide-react';
import { approvePrAction, openPrExternal } from '../../hooks/queueActions';
import type { AgentRun } from '../../shared/agent-types';
import type { PullRequest } from '../../shared/review-types';
import { relativeAge } from '../../utils/time';
import { AgentCell, ChecksCell, ReviewCell, SizeCell } from './cells';

export const QUEUE_GRID = 'grid grid-cols-[minmax(0,1fr)_130px_160px_140px_190px] gap-3 items-center px-4';

type Props = {
  pr: PullRequest;
  run: AgentRun | undefined;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
};

export function QueueRow({ pr, run, focused, onFocus, onOpen }: Props) {
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
        'group py-2 border-b border-border/60 cursor-pointer relative',
        QUEUE_GRID,
        focused ? 'bg-accent/60 shadow-[inset_2px_0_0_0_var(--color-primary)]' : 'hover:bg-accent/30'
      )}
    >
      <div className="min-w-0">
        <div className="text-sm truncate" title={pr.title}>
          {pr.title}
        </div>
        <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
          #{pr.number} · {pr.repo} · @{pr.author} · {pr.headRef} → {pr.baseRef} · {relativeAge(pr.updatedAt)}
        </div>
      </div>
      <ChecksCell pr={pr} />
      <ReviewCell pr={pr} />
      <SizeCell pr={pr} />
      <div className="flex items-center justify-between gap-2 min-w-0">
        <AgentCell run={run} />
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={pr.isDraft || !!blocker}
            title={blocker ? `Agent found a blocker: ${blocker.title} (shift+A overrides)` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              void approvePrAction(queryClient, pr.prId);
            }}
          >
            <Check className="w-3 h-3 mr-1" /> Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Open on GitHub"
            onClick={(e) => {
              e.stopPropagation();
              openPrExternal(pr.url);
            }}
          >
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
