import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@uipath/apollo-wind";
import { ArrowLeft } from "lucide-react";
import { navigateToQueue } from "../../routes";
import type { PullRequest } from "../../shared/review-types";
import { ReviewCell } from "../queue/cells";

const CHECK_DOT: Record<string, string> = {
  success: "bg-emerald-400",
  failure: "bg-red-400",
  pending: "bg-yellow-400",
  neutral: "bg-muted-foreground/50",
  skipped: "bg-muted-foreground/30",
};

export function PrHeader({ pr }: { pr: PullRequest }) {
  return (
    <div className="border-b border-border px-4 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground"
          onClick={navigateToQueue}
        >
          <ArrowLeft className="w-3 h-3" /> Queue
        </button>
        <span>/</span>
        <span>
          {pr.owner}/{pr.repo}
        </span>
        <span>/</span>
        <span>#{pr.number}</span>
      </div>
      <h1 className="text-lg font-semibold tracking-tight leading-snug">
        {pr.title}{" "}
        <span className="text-muted-foreground font-normal">#{pr.number}</span>
      </h1>
      <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
        <span className="border border-border rounded px-1.5 py-0.5 text-muted-foreground">
          {pr.headRef} → {pr.baseRef}
        </span>
        <ReviewCell pr={pr} />
        <span className="text-muted-foreground">@{pr.author}</span>
        <span className="text-muted-foreground">{pr.changedFiles} files</span>
        <span>
          <span className="text-emerald-400">+{pr.additions}</span>{" "}
          <span className="text-red-400">−{pr.deletions}</span>
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-2">
          {pr.checkRuns.slice(0, 8).map((check, i) => (
            // Matrix jobs can share a name — the index keeps keys unique.
            <Tooltip key={`${check.name}-${i}`}>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span
                    className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full",
                      CHECK_DOT[check.status],
                    )}
                  />
                  <span className="max-w-24 truncate">{check.name}</span>
                </span>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>
                  {check.name}: {check.status}
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          ))}
          {pr.checkRuns.length > 8 ? (
            <span className="text-muted-foreground">
              +{pr.checkRuns.length - 8}
            </span>
          ) : null}
        </span>
        <span className="border border-border rounded px-1.5 py-0.5 text-muted-foreground">
          {pr.headSha.slice(0, 7)}
        </span>
      </div>
    </div>
  );
}
