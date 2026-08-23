import { Badge, Spinner, cn } from "@uipath/apollo-wind";
import {
  SKIP_REASON_LABEL,
  type AgentRun,
  type Severity,
} from "../../shared/agent-types";
import type { PullRequest } from "../../shared/review-types";
import { relativeAge } from "../../utils/time";
import { SeverityBadge } from "../agent/SeverityBadge";

export function ChecksCell({ pr }: { pr: PullRequest }) {
  if (pr.checkRollup === "NONE") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Dot className="bg-muted-foreground/40" /> no checks
      </span>
    );
  }
  const failing = pr.checkRuns.filter((c) => c.status === "failure").length;
  const pending = pr.checkRuns.filter((c) => c.status === "pending").length;
  const passing = pr.checkRuns.filter((c) => c.status === "success").length;

  if (pr.checkRollup === "FAILURE") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-500 dark:text-red-400">
        <Dot className="bg-red-500 dark:bg-red-400" /> {failing || 1} failing
      </span>
    );
  }
  if (pr.checkRollup === "PENDING") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
        <Dot className="bg-yellow-500 dark:bg-yellow-400" /> {pending || 1}{" "}
        pending
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Dot className="bg-emerald-500 dark:bg-emerald-400" />{" "}
      {passing || pr.checkRuns.length} passing
    </span>
  );
}

/** `showDraft={false}` where a state pill already says Draft (the PR header). */
export function ReviewCell({
  pr,
  showDraft = true,
}: {
  pr: PullRequest;
  showDraft?: boolean;
}) {
  if (pr.isDraft && showDraft) {
    return (
      <Badge variant="outline" className="border-dashed text-muted-foreground">
        Draft
      </Badge>
    );
  }
  switch (pr.reviewDecision) {
    case "CHANGES_REQUESTED":
      return <Badge variant="error">Changes requested</Badge>;
    case "APPROVED":
      return <Badge variant="success">Approved</Badge>;
    case "REVIEW_REQUIRED":
      return <Badge variant="warning">Awaiting you</Badge>;
    default:
      return <Badge variant="secondary">No review</Badge>;
  }
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

// Four visual states (spec §3.1): Analyzing… (pulsing), findings tally,
// "Nothing to flag" (as legible as a finding — it earns the trust), and
// Skipped with its reason. Violet marks it all as machine-authored.
export function AgentCell({ run }: { run: AgentRun | undefined }) {
  if (!run) return <span className="text-xs text-muted-foreground/60">—</span>;

  if (
    run.status === "queued" ||
    run.status === "fetching" ||
    run.status === "analyzing"
  ) {
    return (
      <span
        className="flex items-center gap-1.5 text-xs font-medium motion-safe:animate-pulse"
        style={{ color: "var(--tandem-agent)" }}
      >
        <Spinner className="size-3" /> Analyzing…
      </span>
    );
  }

  if (run.status === "skipped") {
    return (
      <span className="text-xs text-muted-foreground">
        Skipped · {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : ""}
      </span>
    );
  }

  if (run.status === "failed") {
    return (
      <span className="text-xs font-medium text-red-500 dark:text-red-400">
        Run failed
      </span>
    );
  }

  if (run.status === "stale") {
    return (
      <span className="text-xs text-yellow-600 dark:text-yellow-400">
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
  const triage = run.findings.filter((f) => f.state !== "dismissed");
  if (triage.length === 0) {
    return (
      <span className="text-xs">
        <span className="font-medium">Nothing to flag</span>
        {score}
        <span className="text-muted-foreground">
          {run.autoApproved ? " · " : " · safe to review fast"}
        </span>
        {run.autoApproved ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            ✓ auto-approved
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1 min-w-0">
      <span
        className="text-xs font-medium"
        style={{ color: "var(--tandem-agent)" }}
      >
        {triage.length} finding{triage.length === 1 ? "" : "s"} ready
        {score}
        {run.autoApproved ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            {" "}
            · ✓ auto-approved
          </span>
        ) : null}
      </span>
      <span className="flex gap-1 flex-wrap">
        {TALLY_ORDER.map((severity) => (
          <SeverityBadge
            key={severity}
            severity={severity}
            count={triage.filter((f) => f.severity === severity).length}
          />
        ))}
      </span>
    </span>
  );
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
