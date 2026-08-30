import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import {
  SKIP_REASON_LABEL,
  type AgentRun,
  type Severity,
} from "../../shared/agent-types";
import {
  PULSE_LABELS,
  awaitsViewer,
  isAutoMerging,
  pulseOf,
  reviewStandingOf,
  type PulseOptions,
  type ReviewStanding,
} from "../../shared/pulse";
import {
  checkHeadlineOf,
  countByStatus,
  dedupeChecks,
  shortCheckLabel,
  type CheckHeadline,
  type CheckTone,
} from "../../shared/checks";
import { Check, Play } from "lucide-react";
import type { PrId, PullRequest } from "../../shared/review-types";
import {
  PULSE_COLOR,
  PULSE_ICON,
  PULSE_REASON_ICON,
  SIGNAL_ICON,
} from "./pulseIcons";
import { startRunAction } from "../../actions/queue";
import { relativeAge } from "../../utils/time";
import { AgentSpinner } from "../agent/AgentSpinner";
import { SeverityBadge } from "../agent/SeverityBadge";

/** Whose court the ball is in — the row's one-word answer to "so what?". */
export function PulseCell({
  pr,
  opts,
}: {
  pr: PullRequest;
  opts: PulseOptions;
}) {
  // A row knows WHICH door it came in by, so it says so — the label stays the
  // bucket's ("needs your fix" here would stop echoing the pill segment you
  // filtered with), and the icon and the tooltip carry the difference.
  const { state, reason, hint } = pulseOf(pr, opts);
  const Icon = reason ? PULSE_REASON_ICON[reason] : PULSE_ICON[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs whitespace-nowrap",
            state === "blocked-on-you" && "font-medium",
          )}
          style={{ color: PULSE_COLOR[state] }}
        >
          <Icon className="size-3 shrink-0" aria-hidden />
          {PULSE_LABELS[state]}
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{hint}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/**
 * The xbar script's glyph vocabulary, kept almost verbatim because it is
 * genuinely good: every mark is a COUNT of something that happened, so none of
 * them need a legend, and a row with nothing to say renders nothing at all
 * rather than a line of zeroes.
 */
export function SignalsCell({ pr }: { pr: PullRequest }) {
  const comments = pr.commentCount + pr.threadCount;
  const marks: Array<{
    key: keyof typeof SIGNAL_ICON;
    value?: number;
    title: string;
    className?: string;
  }> = [];
  if (pr.approvalCount > 0)
    marks.push({
      key: "approvals",
      value: pr.approvalCount,
      title: `${pr.approvalCount} approving review${pr.approvalCount === 1 ? "" : "s"}`,
      className: "text-emerald-600 dark:text-emerald-400",
    });
  if (pr.changesRequestedCount > 0)
    marks.push({
      key: "changes",
      value: pr.changesRequestedCount,
      title: `${pr.changesRequestedCount} review${pr.changesRequestedCount === 1 ? "" : "s"} requesting changes`,
      className: "text-red-500 dark:text-red-400",
    });
  if (comments > 0)
    marks.push({
      key: "comments",
      value: comments,
      title: `${comments} comment${comments === 1 ? "" : "s"} and review threads`,
    });
  if (isAutoMerging(pr))
    marks.push({
      key: "automerge",
      title: `auto-merge armed by @${pr.autoMergeBy}`,
    });
  // No early return on an empty list: this line is the review cell's second
  // row, and skipping it would let the badge above re-centre itself.
  return (
    <span className="flex gap-2 h-3 items-center text-[10px] text-muted-foreground font-mono">
      {marks.map((mark) => {
        const Icon = SIGNAL_ICON[mark.key];
        return (
          <span
            key={mark.key}
            title={mark.title}
            className={cn("flex items-center gap-0.5", mark.className)}
          >
            <Icon className="size-2.5 shrink-0" aria-hidden />
            {mark.value !== undefined ? (
              <span className="tabular-nums">{mark.value}</span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** Tone → the reserved check tokens. One table, so the dot and the text can
 * never drift apart. */
const CHECK_TONE: Record<CheckTone, { text: string; dot: string }> = {
  failure: {
    text: "font-medium text-red-500 dark:text-red-400",
    dot: "bg-red-500 dark:bg-red-400",
  },
  pending: {
    text: "font-medium text-yellow-600 dark:text-yellow-400",
    dot: "bg-yellow-500 dark:bg-yellow-400",
  },
  success: {
    text: "font-medium text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  none: { text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

export function ChecksCell({ pr }: { pr: PullRequest }) {
  // Counting is `checkHeadlineOf`'s job, not this cell's — the numbers here
  // used to be counts of the fetched WINDOW, and `|| 1` invented one whenever
  // the window held no failure to count.
  const head = checkHeadlineOf(pr);
  const tone = CHECK_TONE[head.tone];
  const label = shortCheckLabel(head);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("flex items-center gap-1.5 text-xs", tone.text)}>
          <Dot className={tone.dot} /> {label}
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{checkTooltip(pr, head)}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/**
 * The queue fetches no per-check nodes, so this says what IS known and points
 * at where the breakdown lives — rather than counting a window (which is what
 * printed "18 passing" about a PR with 40 green checks).
 */
function checkTooltip(pr: PullRequest, head: CheckHeadline): string {
  if (head.tone === "none") return "no checks on the head commit";
  const scale = `${head.total} check${head.total === 1 ? "" : "s"} on the head commit`;
  if (pr.checkRuns.length === 0) {
    const verdict =
      head.tone === "failure"
        ? "GitHub reports some are not passing"
        : head.tone === "pending"
          ? "GitHub reports some still running"
          : "GitHub reports them green";
    return `${scale} · ${verdict} — open the PR for the per-check breakdown`;
  }
  const runs = dedupeChecks(pr.checkRuns);
  const parts = (
    [
      ["failing", "failure"],
      ["cancelled", "cancelled"],
      ["running", "pending"],
      ["passing", "success"],
      ["neutral", "neutral"],
      ["skipped", "skipped"],
    ] as const
  )
    .map(([word, status]) => {
      const n = countByStatus(runs, status);
      return n > 0 ? `${n} ${word}` : null;
    })
    .filter((part): part is string => part !== null);
  const body = `${parts.join(" · ")} of ${head.total}`;
  return head.partial
    ? `${body} — only ${pr.checkRuns.length} were fetched, so these are lower bounds`
    : body;
}

/**
 * `showDraft={false}` where a state pill already says Draft (the PR header).
 *
 * YOUR OWN review is checked first and wins the badge: it is the one thing
 * this app can never be wrong about, and `reviewDecision` is null on any base
 * branch without a required-reviews rule — so a PR you approved yourself
 * reported null and rendered "No review", which reads as "nobody has looked at
 * this".
 *
 * Everything after that is `reviewStandingOf`, NOT `reviewDecision`. That same
 * null covers a TEAMMATE's approval too, and rescuing only your own left the
 * hole half-patched: the pulse column reads the counts (via `isApproved`) and
 * SignalsCell prints them one line below, so an approved PR on an unprotected
 * branch said "ready to merge", "No review" and "✓1" all at once.
 */
export function ReviewCell({
  pr,
  showDraft,
  viewerLogin,
}: {
  pr: PullRequest;
  showDraft?: boolean;
  /** Passed in, never read from a hook here: this renders once per queue row,
   * and one badge must not subscribe 50 components to a query. */
  viewerLogin?: string | null;
}) {
  // Resolve the verdict first, render once. "You requested changes" is the
  // longest label and it does not fit the queue column, so every badge
  // truncates — a rule that has to hold for all of them, which is easier to
  // see when there is one <Badge> rather than seven.
  // Default in the body, never in the parameter — see the React Compiler
  // pitfall in CLAUDE.md.
  const { variant, label, extra } = reviewBadge(
    pr,
    showDraft ?? true,
    viewerLogin,
  );
  return (
    <Badge variant={variant} className={cn("max-w-full truncate", extra)}>
      {label}
    </Badge>
  );
}

type ReviewBadge = {
  variant: "outline" | "success" | "error" | "warning" | "secondary";
  label: string;
  extra?: string;
};

/**
 * Same warning token either way: "awaiting" is ONE review state and the color
 * is the state, not how much it is your problem. Whose court it is in is the
 * pulse column's job, one cell to the left.
 */
const AWAITING_YOU: ReviewBadge = { variant: "warning", label: "Awaiting you" };
const AWAITING_REVIEW: ReviewBadge = {
  variant: "warning",
  label: "Awaiting review",
};

/** One badge per verdict, and none of them names a person — they read the
 * same whoever is looking. `awaiting` is the one that can be narrowed to YOU,
 * which `reviewBadge` does before it gets here.
 *
 * "Approved" is deliberately not softened for the count-derived case: a null
 * decision means there is no required-reviews rule, so "one approval and
 * nothing outstanding" IS the complete truth about that PR. */
const VERDICT_BADGE: Record<ReviewStanding, ReviewBadge> = {
  approved: { variant: "success", label: "Approved" },
  "changes-requested": { variant: "error", label: "Changes requested" },
  awaiting: AWAITING_REVIEW,
  none: { variant: "secondary", label: "No review" },
};

function reviewBadge(
  pr: PullRequest,
  showDraft: boolean,
  viewerLogin: string | null | undefined,
): ReviewBadge {
  if (pr.isDraft && showDraft)
    return {
      variant: "outline",
      label: "Draft",
      extra: "border-dashed text-muted-foreground",
    };
  // Only a SUBMITTED verdict of yours counts, and it is checked BEFORE the
  // repo-wide one: COMMENTED left no verdict, DISMISSED was revoked, and
  // PENDING is a GitHub-side draft you never sent.
  if (pr.viewerReviewState === "APPROVED" && pr.reviewDecision !== "APPROVED")
    return { variant: "success", label: "Approved by you" };
  if (
    pr.viewerReviewState === "CHANGES_REQUESTED" &&
    pr.reviewDecision !== "CHANGES_REQUESTED"
  )
    return { variant: "error", label: "You requested changes" };
  // REVIEW_REQUIRED means "a required review is still missing" — it never says
  // WHOSE. Reading it as "Awaiting you" was right only by coincidence on a
  // review-requested:@me view; on your own PRs it is exactly inverted, since
  // the missing review is the codeowners'. `awaitsViewer` is the one rule for
  // "it is yours" (and it already refuses a team request, which is not
  // resolvable to a membership here).
  const verdict = reviewStandingOf(pr);
  if (verdict === "awaiting" && awaitsViewer(pr, viewerLogin))
    return AWAITING_YOU;
  return VERDICT_BADGE[verdict];
}

/**
 * The numbers, plus a churn bar underneath. The bar is scaled LINEARLY against
 * the largest churn among the rows on screen — one shared scale, so "this PR
 * is four times that one" reads down the column — and split by the
 * additions:deletions ratio. The exact counts sit directly above it, so the
 * mark never has to carry a value on its own.
 */
export function SizeCell({
  pr,
  maxChurn,
}: {
  pr: PullRequest;
  maxChurn: number;
}) {
  const churn = pr.additions + pr.deletions;
  const share = maxChurn > 0 ? churn / maxChurn : 0;
  const addPct = churn > 0 ? (pr.additions / churn) * 100 : 0;
  return (
    <span className="flex flex-col gap-1 whitespace-nowrap">
      <span className="text-xs font-mono">
        <span className="text-emerald-600 dark:text-emerald-400">
          +{compact(pr.additions)}
        </span>{" "}
        <span className="text-red-500 dark:text-red-400">
          −{compact(pr.deletions)}
        </span>{" "}
        <span className="text-muted-foreground">· {pr.changedFiles}f</span>
      </span>
      {/* 2px surface gap between the two fills — never a border. */}
      <span
        className="flex gap-[2px] h-1 w-14 rounded-[1px] bg-foreground/[0.06] overflow-hidden"
        aria-hidden
        title={`${churn} lines changed`}
      >
        <span
          className="flex gap-[2px] h-full"
          // Floored at 3px: a 12-line PR beside a 4,000-line one is still a
          // row, and an invisible mark reads as missing data.
          style={{ width: `max(3px, ${share * 100}%)` }}
        >
          <span
            className="bg-emerald-600 dark:bg-emerald-400 rounded-[1px]"
            style={{ width: `${addPct}%` }}
          />
          <span className="bg-red-500 dark:bg-red-400 rounded-[1px] flex-1" />
        </span>
      </span>
    </span>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Updated + created ages; the updated age colors as the PR goes stale.
 * `now` comes from the table's useNow ticker (render purity). */
export function AgeCell({ pr, now }: { pr: PullRequest; now: number }) {
  const idleDays = (now - new Date(pr.updatedAt).getTime()) / DAY;
  return (
    <span className="flex flex-col gap-0.5 whitespace-nowrap">
      <span
        className={cn(
          "text-xs",
          idleDays > 21
            ? "text-red-500 dark:text-red-400 font-medium"
            : idleDays > 7
              ? "text-yellow-600 dark:text-yellow-400 font-medium"
              : "text-foreground/80",
        )}
        title={`last updated ${new Date(pr.updatedAt).toLocaleString()}`}
      >
        {relativeAge(pr.updatedAt, now)}
      </span>
      <span
        className="text-[10px] text-muted-foreground"
        title={`opened ${new Date(pr.createdAt).toLocaleString()}`}
      >
        opened {relativeAge(pr.createdAt, now)}
      </span>
    </span>
  );
}

const TALLY_ORDER: Severity[] = [
  "blocker",
  "risk",
  "nit",
  "question",
  "praise",
];

/**
 * Four visual states (spec §3.1): Analyzing… (pulsing), findings tally,
 * "Nothing to flag" (as legible as a finding — it earns the trust), and
 * Skipped with its reason. Violet marks it all as machine-authored.
 *
 * ONE SHAPE for every state: a status line, and a second line reserved for
 * severity chips whether or not there are any. The states used to be one line
 * or two depending on which they were, so scrolling the queue slid this
 * column's text up and down against the five beside it that never move.
 */
export function AgentCell({
  prId,
  run,
}: {
  prId: PrId;
  run: AgentRun | undefined;
}) {
  return (
    <span className="flex flex-col gap-1 min-w-0">
      <span className="text-xs truncate">
        {run ? statusLine(run) : <RunAgentButton prId={prId} />}
      </span>
      {/* Reserved, and it never wraps: the row is a fixed h-14 and clips, so a
          wrapping chip list would silently lose its own second row. */}
      <span className="flex gap-1 h-4 items-center overflow-hidden">
        {severityChips(run)}
      </span>
    </span>
  );
}

/**
 * The never-run state is the DEFAULT one (`settings.autoRunEnabled` is off, so
 * nothing runs on its own) — it used to be an em-dash, which said the agent had
 * nothing to say rather than that nobody had asked it. The button lives on the
 * first line and is height-clamped to it: the agent column is always two lines
 * and an h-7 control here would push the chip row down on exactly the rows that
 * have no chips, which is the drift the two-line rule exists to prevent.
 */
function RunAgentButton({ prId }: { prId: PrId }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => startRunAction(queryClient, prId),
  });
  return (
    <Button
      size="2xs"
      variant="ghost"
      className="h-4 -ml-1.5 px-1.5 gap-1 text-muted-foreground hover:text-foreground"
      disabled={start.isPending}
      onClick={(e) => {
        e.stopPropagation();
        start.mutate();
      }}
    >
      {start.isPending ? (
        <AgentSpinner className="size-3" />
      ) : (
        <Play className="size-3" />
      )}
      Run agent
    </Button>
  );
}

function statusLine(run: AgentRun): React.ReactNode {
  switch (run.status) {
    case "queued":
    case "fetching":
    case "analyzing":
      return (
        <span
          className="flex items-center gap-1.5 font-medium motion-safe:animate-pulse"
          style={{ color: "var(--tandem-agent)" }}
        >
          <AgentSpinner className="size-3" /> Analyzing…
        </span>
      );
    case "skipped":
      return (
        <span className="text-muted-foreground">
          Skipped · {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : ""}
        </span>
      );
    case "failed":
      return (
        <span className="font-medium text-red-500 dark:text-red-400">
          Run failed
        </span>
      );
    case "stale":
      return (
        <span className="text-yellow-600 dark:text-yellow-400">
          Stale · new commits
        </span>
      );
  }

  // The number and its meter are ONE unit — they must never wrap apart, or the
  // bar reads as belonging to whatever text lands beside it.
  const score =
    run.score !== undefined ? (
      <span className="text-muted-foreground font-normal whitespace-nowrap">
        {" · "}
        {run.score}/100 <ScoreMeter score={run.score} />
      </span>
    ) : null;
  const approved = run.autoApproved ? (
    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
      {" · "}
      <Check className="size-3" aria-hidden /> auto-approved
    </span>
  ) : null;

  const open = triageFindings(run).length;
  if (open === 0) {
    return (
      <>
        <span className="font-medium">Nothing to flag</span>
        {score}
        {approved ?? (
          <span className="text-muted-foreground"> · safe to review fast</span>
        )}
      </>
    );
  }
  return (
    <>
      <span className="font-medium" style={{ color: "var(--tandem-agent)" }}>
        {open} finding{open === 1 ? "" : "s"} ready
      </span>
      {score}
      {approved}
    </>
  );
}

function severityChips(run: AgentRun | undefined): React.ReactNode {
  if (run?.status !== "ready") return null;
  const triage = triageFindings(run);
  return TALLY_ORDER.map((severity) => (
    <SeverityBadge
      key={severity}
      severity={severity}
      count={triage.filter((f) => f.severity === severity).length}
    />
  ));
}

function triageFindings(run: AgentRun) {
  return run.findings.filter((f) => f.state !== "dismissed");
}

/** Merge-readiness as a meter beside its number. Violet because the score is
 * machine-authored (spec §1 principle 3); the track is the same hue's wash, so
 * the whole bar reads as one scale. Null when the pass didn't emit a score. */
function ScoreMeter({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span
      className="inline-block align-middle w-5 h-1 rounded-[1px] shrink-0 overflow-hidden"
      style={{
        background: "color-mix(in srgb, var(--tandem-agent) 22%, transparent)",
      }}
      aria-hidden
    >
      <span
        className="block h-full rounded-[1px]"
        style={{ width: `${pct}%`, background: "var(--tandem-agent)" }}
      />
    </span>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function Dot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        className,
      )}
    />
  );
}
