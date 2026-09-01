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
import { HeaderDivider } from "../layout/AppHeader";
import { Shortcut } from "../common/Kbd";
import { ReviewCell } from "../queue/cells";
import { useConfigStatus } from "../../hooks/useConfigStatus";
import { ChecksSummary } from "./ChecksSummary";

/**
 * The PR breadcrumb AND title, rendered into the app header's screen slot —
 * the detail screen's vertical space belongs to the diff, and the title was
 * costing a whole row of it. Breadcrumb first (fixed-ish width, so it anchors
 * the row), then the title in the flexible space.
 */
export function PrBreadcrumb({ pr }: { pr?: PullRequest }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0 flex-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="2xs"
            icon
            variant="ghost"
            className="cursor-pointer"
            aria-label="Back to queue"
            onClick={navigateToQueue}
          >
            <ArrowLeft />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>
            Back to queue <Shortcut keys="esc" className="ml-1.5" />
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
      {pr ? (
        <>
          {/* Capped rather than free-growing: the title is what this row is
              for, and a long org/repo must not eat it. */}
          <span className="truncate max-w-[30ch]">
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
                className="cursor-pointer"
                aria-label="Open on GitHub"
                onClick={() => openPrExternal(pr.url)}
              >
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>
                Open on GitHub <Shortcut keys="o" className="ml-1.5" />
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <HeaderDivider />
          <Tooltip>
            <TooltipTrigger asChild>
              <h1 className="font-sans text-[13px] font-semibold text-foreground truncate min-w-0 flex-1">
                {pr.title}
              </h1>
            </TooltipTrigger>
            <TooltipPortal>
              {/* The truncation is the point of the layout, so the full title
                  has to be reachable without leaving the screen. */}
              <TooltipContent className="max-w-lg font-sans">
                {pr.title}
              </TooltipContent>
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
          className="cursor-pointer shrink-0"
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

/**
 * The PR's meta row. Its right end is where the review LIVES now: GitHub's
 * current verdict and the button that changes it, adjacent — the submit CTA
 * came up out of a bottom tray (see `ReviewSubmit`) and the badge came across
 * the row to meet it, because "where does this review stand" and "move it" are
 * one question asked twice.
 */
export function PrHeader({
  pr,
  submit,
}: {
  pr: PullRequest;
  submit?: React.ReactNode;
}) {
  const commits = pr.commitCount ?? 1;
  // The review badge names a person for REVIEW_REQUIRED, so it needs to know
  // who you are. One header, one subscription — the queue passes its already
  // resolved login down a row instead.
  const viewerLogin = useConfigStatus().data?.login ?? null;
  return (
    <div className="border-b border-border shrink-0">
      {/* ONE line, and nothing in it wraps — the same rule the queue header
          holds to. The row is the review's control strip now, so a long branch
          name or a "Changes requested" badge must not drop the submit button
          onto a second line and shove the diff down the screen. The prose is
          the only flexible child and it TRUNCATES; every control is shrink-0,
          so each one keeps its position whatever the PR is called. */}
      <div className="flex items-center gap-2 px-4 py-1 text-xs min-w-0">
        <StatePill pr={pr} />
        {/* `min-w-0 truncate`, but NOT `flex-1`: with flex-1 the span ate all
            the slack and the copy button rode its far edge, an inch from the
            branch name it copies. Shrink-to-content keeps them adjacent, and
            the spacer AFTER the button takes the slack instead. */}
        <span className="text-muted-foreground truncate min-w-0">
          <span className="font-medium text-foreground">@{pr.author}</span>{" "}
          wants to merge{" "}
          <span className="font-medium text-foreground">
            {commits} {commits === 1 ? "commit" : "commits"}
          </span>{" "}
          into <Ref>{pr.baseRef}</Ref> from <Ref>{pr.headRef}</Ref>
        </span>
        <CopyRef branch={pr.headRef} />
        <span className="flex-1" />
        {/* No file count or churn here — that describes the DIFF and lives in
            the diff pane's own header. What is left is the PR's standing:
            checks, then a divider, then the review. */}
        {/* No `font-mono` on either group. It used to blanket this whole
            right-hand side, which was harmless while everything in it was a
            number — but the review badge renders sans in the queue, and the
            submit CTA is a button, not data. `ChecksSummary` sets its own
            mono, so nothing lost it. */}
        <div className="flex items-center gap-3 shrink-0">
          <ChecksSummary pr={pr} />
        </div>
        <HeaderDivider />
        <div className="flex items-center gap-2 shrink-0">
          <ReviewCell pr={pr} showDraft={false} viewerLogin={viewerLogin} />
          {submit}
        </div>
      </div>
    </div>
  );
}
