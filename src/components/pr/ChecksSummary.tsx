import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@uipath/apollo-wind";
import { ChevronDown } from "lucide-react";
import type { CheckRun, PullRequest } from "../../shared/review-types";

const DOT: Record<CheckRun["status"], string> = {
  success: "bg-emerald-500 dark:bg-emerald-400",
  failure: "bg-red-500 dark:bg-red-400",
  pending: "bg-yellow-500 dark:bg-yellow-400",
  neutral: "bg-muted-foreground/50",
  skipped: "bg-muted-foreground/30",
};

/** Rollup order in the detail list: what's broken or still running reads first. */
const ORDER: Record<CheckRun["status"], number> = {
  failure: 0,
  pending: 1,
  neutral: 2,
  skipped: 3,
  success: 4,
};

/** One line of prose for the trigger: the rollup, plus what's behind it. */
function summarize(pr: PullRequest) {
  const count = (status: CheckRun["status"]) =>
    pr.checkRuns.filter((c) => c.status === status).length;
  const failing = count("failure");
  const pending = count("pending");
  const passing = count("success");
  const total = pr.checkRuns.length;

  if (pr.checkRollup === "FAILURE")
    return {
      tone: "text-red-500 dark:text-red-400",
      dot: DOT.failure,
      label: `${failing || 1} of ${total} checks failing`,
    };
  if (pr.checkRollup === "PENDING")
    return {
      tone: "text-yellow-600 dark:text-yellow-400",
      dot: DOT.pending,
      label: `${pending || 1} of ${total} checks running`,
    };
  return {
    tone: "text-emerald-600 dark:text-emerald-400",
    dot: DOT.success,
    label: `${passing || total} checks passing`,
  };
}

/**
 * Checks as ONE summary line. The per-check dot strip it replaced spent a whole
 * header row on eight truncated names — the names only matter once something is
 * red, and then you want all of them, which is what the popover is for.
 */
export function ChecksSummary({ pr }: { pr: PullRequest }) {
  if (pr.checkRollup === "NONE" || pr.checkRuns.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        no checks
      </span>
    );
  }

  const { tone, dot, label } = summarize(pr);
  const sorted = [...pr.checkRuns].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-sm px-1 -mx-1 font-medium hover:bg-muted/60",
            tone,
          )}
        >
          <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dot)} />
          {label}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          checks · {pr.checkRuns.length}
        </div>
        <ul className="max-h-72 overflow-y-auto py-1 text-xs font-mono">
          {sorted.map((check, i) => {
            // Matrix jobs can share a name — the index keeps keys unique.
            const row = (
              <span className="flex items-center gap-2 px-3 py-1 min-w-0">
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full shrink-0",
                    DOT[check.status],
                  )}
                />
                <span className="truncate flex-1">{check.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {check.status}
                </span>
              </span>
            );
            return (
              <li key={`${check.name}-${i}`}>
                {check.url ? (
                  <a
                    href={check.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block hover:bg-muted/60"
                  >
                    {row}
                  </a>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
