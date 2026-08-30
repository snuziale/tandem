import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@uipath/apollo-wind";
import { ChevronDown } from "lucide-react";
import {
  checkHeadlineOf,
  dedupeChecks,
  type CheckTone,
} from "../../shared/checks";
import type { CheckRun, PullRequest } from "../../shared/review-types";

const DOT: Record<CheckRun["status"], string> = {
  success: "bg-emerald-500 dark:bg-emerald-400",
  failure: "bg-red-500 dark:bg-red-400",
  // Not the failure red: a cancelled run is not a failed one, and this list is
  // where you go to find out which is which.
  cancelled: "bg-orange-500 dark:bg-orange-400",
  pending: "bg-yellow-500 dark:bg-yellow-400",
  neutral: "bg-muted-foreground/50",
  skipped: "bg-muted-foreground/30",
};

/**
 * Three groups, in the order you care about them: what is wrong (failed,
 * cancelled, still running), then what passed, then what never ran. Skipped
 * and neutral sit LAST rather than beside the failures — a skipped job is not
 * a result, and on a repo where a third of the matrix is conditional they were
 * pushing the runs that did report below the fold.
 */
const ORDER: Record<CheckRun["status"], number> = {
  failure: 0,
  cancelled: 0,
  pending: 0,
  success: 1,
  neutral: 2,
  skipped: 2,
};

const TONE: Record<CheckTone, string> = {
  failure: "text-red-500 dark:text-red-400",
  pending: "text-yellow-600 dark:text-yellow-400",
  success: "text-emerald-600 dark:text-emerald-400",
  none: "text-muted-foreground",
};

const TONE_DOT: Record<CheckTone, string> = {
  failure: DOT.failure,
  pending: DOT.pending,
  success: DOT.success,
  none: "bg-muted-foreground/40",
};

/**
 * One line of prose for the trigger. The counting lives in shared/checks.ts —
 * this chip and the queue column say the same thing at different lengths, and
 * when each did its own counting they disagreed with GitHub in the same two
 * ways (a window counted as a total, cancelled printed as failing).
 */
function summarize(pr: PullRequest) {
  const head = checkHeadlineOf(pr);
  const n =
    head.count === null ? null : `${head.count}${head.atLeast ? "+" : ""}`;
  return {
    tone: TONE[head.tone],
    dot: TONE_DOT[head.tone],
    label:
      head.tone === "none"
        ? "no checks"
        : n === null
          ? `checks ${head.word}`
          : `${n} of ${head.total} checks ${head.word}`,
  };
}

/**
 * The chip shell the trigger shares with the header's description toggle: same
 * height, gutter and outline, so the meta row's two controls read as controls
 * and the facts between them read as facts. Only the CONTENT carries status
 * color — the reserved check tokens stay on the dot and label, never on the
 * border, or "outlined" would start to mean something.
 */
const CHIP =
  "flex items-center gap-1.5 h-6 px-1.5 shrink-0 rounded-md border border-input font-mono text-[11px]";

/**
 * Checks as ONE summary line. The per-check dot strip it replaced spent a whole
 * header row on eight truncated names — the names only matter once something is
 * red, and then you want all of them, which is what the popover is for.
 */
export function ChecksSummary({ pr }: { pr: PullRequest }) {
  if (pr.checkRollup === "NONE" || pr.checkRuns.length === 0) {
    // Still a chip, just an inert one: the row's right edge must not shift
    // between a PR with checks and one without.
    return (
      <span className={cn(CHIP, "text-muted-foreground opacity-50")}>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        no checks
      </span>
    );
  }

  const { tone, dot, label } = summarize(pr);
  const head = checkHeadlineOf(pr);
  // The same collapse the headline counted: one row per check, latest attempt.
  // Listing every attempt put three `demo-exists` rows in here — a cancelled
  // one at the top, in red, above the two that replaced it.
  // Group first, then by NAME inside it — numeric collation so a matrix's
  // "[2/5]" sorts before its "[10/5]". A list ordered only by status put
  // sibling shards of one job in whatever order the API returned them.
  const sorted = dedupeChecks(pr.checkRuns).sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            CHIP,
            // PopoverTrigger owns data-state on its child and nothing else
            // wraps this one, so the open state can latch the fill the way
            // the description toggle's pressed state does.
            "font-medium cursor-pointer hover:bg-muted/60 data-[state=open]:bg-foreground/10 data-[state=open]:border-foreground/40",
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
          checks · {sorted.length}
          {head.partial ? ` of ${pr.checkTotal} fetched` : ""}
          {head.collapsed > 0
            ? ` · ${head.collapsed} re-run${head.collapsed === 1 ? "" : "s"} collapsed`
            : ""}
        </div>
        {head.rollupDisagrees ? (
          // github.com shows the rollup, which still counts the attempt that
          // was superseded — so the two genuinely differ and the reader is
          // owed the reason rather than left to spot it.
          <p className="px-3 py-2 border-b border-border text-[11px] leading-snug text-muted-foreground">
            GitHub&rsquo;s own rollup still reads{" "}
            <span className="font-mono">{pr.checkRollup.toLowerCase()}</span>:
            it counts every attempt on the commit, including ones a later re-run
            replaced.
          </p>
        ) : null}
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
