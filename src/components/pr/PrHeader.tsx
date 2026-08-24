import { useState } from "react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { openPrExternal } from "../../actions/queue";
import { navigateToQueue } from "../../routes";
import type { PrState, PullRequest } from "../../shared/review-types";
import { ReviewCell } from "../queue/cells";
import { ChecksSummary } from "./ChecksSummary";

/**
 * The PR breadcrumb, rendered into the app header's screen slot — the detail
 * screen's vertical space belongs to the diff, and this row was only ever one
 * line of chrome.
 */
export function PrBreadcrumb({ pr }: { pr?: PullRequest }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0">
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground shrink-0"
        onClick={navigateToQueue}
      >
        <ArrowLeft className="w-3 h-3" /> Queue
      </button>
      {pr ? (
        <>
          <span>/</span>
          <span className="truncate">
            {pr.owner}/{pr.repo}
          </span>
          <span>/</span>
          <span className="shrink-0">#{pr.number}</span>
          {/* Opening the PR on GitHub belongs to the PR, not to the diff pane
              it used to sit in. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="2xs"
                icon
                variant="ghost"
                aria-label="Open on GitHub"
                onClick={() => openPrExternal(pr.url)}
              >
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>Open on GitHub (o)</TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

// Merged is deliberately NOT purple: violet belongs to the agent and nothing
// else (invariant 3). The merge icon carries the state on its own.
const STATE_PILL: Record<
  PrState | "DRAFT",
  { label: string; icon: typeof GitPullRequest; className: string }
> = {
  OPEN: {
    label: "Open",
    icon: GitPullRequest,
    className: "bg-emerald-600 text-white dark:bg-emerald-500",
  },
  DRAFT: {
    label: "Draft",
    icon: GitPullRequestDraft,
    className: "bg-muted text-muted-foreground border border-border",
  },
  MERGED: {
    label: "Merged",
    icon: GitMerge,
    className: "bg-slate-600 text-white dark:bg-slate-500",
  },
  CLOSED: {
    label: "Closed",
    icon: GitPullRequestClosed,
    className: "bg-red-600 text-white dark:bg-red-500",
  },
};

function StatePill({ pr }: { pr: PullRequest }) {
  // Draft outranks OPEN — that's the state a reviewer acts on. The OPEN
  // fallback is load-bearing: an unrestarted server (or a state GitHub adds
  // later) sends a value this table has no row for, and the header must
  // still render.
  const {
    label,
    icon: Icon,
    className,
  } = STATE_PILL[pr.isDraft ? "DRAFT" : pr.state] ?? STATE_PILL.OPEN;
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-0.5 text-xs font-semibold shrink-0",
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

/** A git ref, GitHub's chip treatment. */
function Ref({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded px-1.5 py-0.5 font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400">
      {children}
    </span>
  );
}

function CopyRef({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label="Copy branch name"
          onClick={() => {
            void navigator.clipboard.writeText(branch).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>
          {copied ? "Copied" : "Copy branch name"}
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export function PrHeader({ pr }: { pr: PullRequest }) {
  const commits = pr.commitCount ?? 1;
  return (
    <div className="border-b border-border px-4 py-2.5 space-y-2">
      <h1 className="text-lg font-semibold tracking-tight leading-snug">
        {pr.title}
      </h1>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <StatePill pr={pr} />
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">@{pr.author}</span>{" "}
          wants to merge{" "}
          <span className="font-medium text-foreground">
            {commits} {commits === 1 ? "commit" : "commits"}
          </span>{" "}
          into <Ref>{pr.baseRef}</Ref> from <Ref>{pr.headRef}</Ref>
        </span>
        <CopyRef branch={pr.headRef} />
        <span className="flex-1" />
        <div className="flex items-center gap-3 font-mono">
          <ReviewCell pr={pr} showDraft={false} />
          <span className="text-muted-foreground">{pr.changedFiles} files</span>
          <span>
            <span className="text-emerald-400">+{pr.additions}</span>{" "}
            <span className="text-red-400">−{pr.deletions}</span>
          </span>
          <ChecksSummary pr={pr} />
        </div>
      </div>
    </div>
  );
}
