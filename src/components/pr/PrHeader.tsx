import { useState } from "react";
import {
  Button,
  Toggle,
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
  Text,
} from "lucide-react";
import { openPrExternal } from "../../actions/queue";
import { navigateToQueue } from "../../routes";
import type { PrState, PullRequest } from "../../shared/review-types";
import { HeaderDivider } from "../layout/AppHeader";
import { Markdown } from "../common/Markdown";
import { Shortcut } from "../common/Kbd";
import { ReviewCell } from "../queue/cells";
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
          className="cursor-pointer"
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

/** PR templates ship as HTML comments — a body that is only comments is empty. */
function descriptionOf(body: string) {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!text) return null;
  return { text, paragraphs: text.split(/\n{2,}/).length };
}

/**
 * The description toggle. It leads the meta row rather than joining the stats
 * on the right: it is a control, not a fact about the PR, and the row's left
 * edge is the one position that doesn't move as the stats change width. Kept
 * mounted (disabled) when there is no description so the row never reflows
 * between PRs.
 */
function DescriptionToggle({
  paragraphs,
  open,
  onToggle,
}: {
  paragraphs: number | null;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const label =
    paragraphs === null
      ? "No description"
      : `${open ? "Hide" : "Show"} description · ${paragraphs} paragraph${
          paragraphs === 1 ? "" : "s"
        }`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A Toggle, not a Button: latched is the state worth seeing, and the
            fill is what changes — the control keeps its width. Styled off
            aria-pressed, NOT data-state: the tooltip trigger owns data-state
            on its child, so the toggle's own on/off never reaches the DOM
            (same reason as the `ws` toggle in the diff toolbar). */}
        <Toggle
          size="xs"
          variant="outline"
          pressed={open}
          disabled={paragraphs === null}
          onPressedChange={onToggle}
          aria-label={label}
          className="h-6 px-1.5 gap-1 min-w-0 shrink-0 font-mono text-[11px] cursor-pointer disabled:cursor-default aria-pressed:bg-foreground/10 aria-pressed:border-foreground/40 aria-pressed:text-foreground future:aria-pressed:text-foreground"
        >
          <Text className="w-3 h-3" />
          {paragraphs ?? 0}
        </Toggle>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{label}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export function PrHeader({ pr }: { pr: PullRequest }) {
  const commits = pr.commitCount ?? 1;
  // Local, and closed on every PR: the description is something you consult
  // once, not a pane preference.
  const [descOpen, setDescOpen] = useState(false);
  const description = descriptionOf(pr.bodyMarkdown);

  return (
    <div className="border-b border-border shrink-0">
      <div className="flex items-center gap-2 px-4 py-2.5 text-xs flex-wrap">
        <DescriptionToggle
          paragraphs={description?.paragraphs ?? null}
          open={descOpen}
          onToggle={setDescOpen}
        />
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
      {descOpen && description ? (
        // Fills the pane, starting at the same gutter as the meta row — PR
        // descriptions carry tables, code fences and checklists, and a narrow
        // centred column wraps all three badly. Capped only so an ultrawide
        // window doesn't produce 300-character prose lines.
        <div className="border-t border-border px-4 py-3 max-h-[45dvh] overflow-y-auto">
          <Markdown className="min-w-0 max-w-[1400px]">
            {description.text}
          </Markdown>
        </div>
      ) : null}
    </div>
  );
}
