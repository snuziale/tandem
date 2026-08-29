// What the agent pane shows before a review exists at this commit.
//
// It replaced a bare "Run agent" button — a spend commitment with nothing to
// weigh it against — with the three things already sitting in memory when the
// screen paints: what the agent found on an EARLIER commit of this PR, what a
// run here would cost and how long it would take, and whether the pipeline
// would refuse it outright.
//
// The rule the card is built on: never ask for a decision without handing over
// what the decision turns on.
import { useState } from "react";
import { Button, cn } from "@uipath/apollo-wind";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  SKIP_REASON_LABEL,
  type Finding,
  type SkipReason,
} from "../../shared/agent-types";
import type { DiffSide } from "../../shared/review-types";
import { Markdown } from "../common/Markdown";
import { Shortcut } from "../common/Kbd";
import { relativeAge } from "../../utils/time";
import { fileName, shortSha } from "../../utils/agentFormat";
import { SeverityBadge } from "./SeverityBadge";
import { SeverityTally } from "./SeverityTally";
import type { Preflight, PriorReview } from "./preflight";

/**
 * What a reviewer can DO about each skip, in the pane rather than in a
 * settings page they would have to go find. `SKIP_REASON_LABEL` already names
 * the reason; this is the sentence after it.
 */
const SKIP_FIX: Record<SkipReason, string> = {
  draft: "Settings › Review policy can turn that off.",
  "too-many-files": "Raise the file cap in Settings › Review policy.",
  "diff-too-large": "Raise the line cap in Settings › Review policy.",
  "generated-only": "There is nothing here it would read.",
  budget: "Raise the daily ceiling in Settings › Review policy, or wait.",
  "agent-disabled": "Turn it on for this repo in Settings › Review policy.",
};

export function PreflightCard({
  preflight,
  prior,
  starting,
  onStart,
  onRevealPath,
}: {
  preflight: Preflight | null;
  prior: PriorReview | null;
  starting: boolean;
  onStart: () => void;
  /** Show a prior finding's file in the diff. The FILE, never the line: that
   * finding was anchored against a different commit, so its line number is
   * the one thing about it that has certainly moved. */
  onRevealPath: (path: string, side: DiffSide) => void;
}) {
  const skip = preflight?.decision.skip ? preflight.decision.reason : null;
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="text-sm">
        <div className="font-medium">Not reviewed at this commit.</div>
        {prior ? null : (
          <div className="text-muted-foreground text-xs mt-0.5">
            The agent has not read this pull request yet.
          </div>
        )}
      </div>

      {prior ? (
        <PriorReviewCard prior={prior} onRevealPath={onRevealPath} />
      ) : null}

      {preflight ? (
        <Shape preflight={preflight} skipped={skip !== null} />
      ) : null}

      {skip ? (
        // No button. A manual run applies `skipDecision` too — `force` only
        // bypasses the sha cache — so offering one here would spend a fetch to
        // produce a Skipped record and tell the reviewer nothing they are not
        // being told right now.
        <div className="rounded border border-border bg-accent/30 px-2 py-1.5">
          <div className="text-xs">
            A review here would be skipped ·{" "}
            <span className="font-mono">{SKIP_REASON_LABEL[skip]}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {SKIP_FIX[skip]}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={onStart}
            disabled={starting}
          >
            {starting ? "Starting…" : "Review this commit"}
            {starting ? null : (
              <Shortcut keys="r" className="ml-1.5 opacity-70" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The shape of the run: what it would read, and what that costs. */
function Shape({
  preflight,
  skipped,
}: {
  preflight: Preflight;
  skipped: boolean;
}) {
  // Spelled out rather than through `formatSpend`: that one falls back to a
  // token count at $0, and "0k tok of $5.00" is not a sentence. A budget line
  // is about the ceiling, so both halves are dollars or there is no line.
  const budget =
    preflight.dailyCostUsd > 0
      ? `$${preflight.spentTodayUsd.toFixed(2)} of $${preflight.dailyCostUsd.toFixed(2)} spent today`
      : null;
  return (
    <div
      className={cn(
        "text-[11px] font-mono text-muted-foreground leading-relaxed",
        skipped && "opacity-60",
      )}
    >
      <div>
        {preflight.analyzed} file{preflight.analyzed === 1 ? "" : "s"} to read ·{" "}
        {preflight.diffLines} diff lines ·{" "}
        {/* Passes, not seconds: the count is knowable and a duration is a
            guess, and a guessed ETA that runs long is worse than no ETA. */}
        {preflight.passes} pass{preflight.passes === 1 ? "" : "es"}
      </div>
      {budget ? <div>{budget}</div> : null}
    </div>
  );
}

/**
 * The review that already happened, on a commit that is no longer head.
 *
 * This is the whole reason the card exists. Those runs are kept deliberately —
 * the staleness sweep marks findings stale and never deletes them — and until
 * now the pane simply never looked, because it only ever asked for the current
 * sha. It is evidence, not an answer, and the copy says so: the score and
 * summary are quoted as of that commit, and findings that point at files this
 * commit no longer touches are counted separately rather than dropped.
 */
function PriorReviewCard({
  prior,
  onRevealPath,
}: {
  prior: PriorReview;
  onRevealPath: (path: string, side: DiffSide) => void;
}) {
  const [open, setOpen] = useState(false);
  // `findings` comes from `priorReviewFor`, which already filtered it to
  // produce live/total — recomputing it here is how the headline and the rows
  // under it become two different answers to one question.
  const { run, findings, live, total } = prior;
  const when = run.finishedAt ? relativeAge(run.finishedAt) : "";

  return (
    <div
      className="rounded border bg-accent/20"
      style={{ borderColor: "var(--tandem-agent-dim)" }}
    >
      <div className="px-2 pt-1.5 pb-1 flex items-center gap-1.5 text-[10px] font-mono">
        <span style={{ color: "var(--tandem-agent)" }}>● reviewed earlier</span>
        <span className="text-muted-foreground truncate">
          {shortSha(run.headSha)}
          {when ? ` · ${when}` : ""}
        </span>
        <span className="flex-1" />
        {run.score !== undefined ? (
          <span className="text-muted-foreground">{run.score}/100</span>
        ) : null}
      </div>

      {run.summary ? (
        <Markdown className="px-2 pb-1 text-xs text-muted-foreground">
          {run.summary}
        </Markdown>
      ) : null}

      {total > 0 ? (
        <>
          <div className="px-2 pb-1 flex flex-wrap items-center gap-1">
            <SeverityTally findings={findings} />
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="w-full flex items-center gap-1 px-2 pb-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {/* The honest headline. "5 findings" would imply they all still
                apply; most of the value is in knowing how many landed on code
                this commit still changes. */}
            {live} of {total} still point at files this commit changes
          </button>
          {open ? (
            <div className="border-t border-border/60 px-1 py-1 space-y-0.5">
              {findings.map((f) => (
                <PriorFindingRow
                  key={f.id}
                  finding={f}
                  onRevealPath={onRevealPath}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="px-2 pb-1.5 text-[11px] text-muted-foreground">
          It flagged nothing at that commit.
        </div>
      )}
    </div>
  );
}

function PriorFindingRow({
  finding,
  onRevealPath,
}: {
  finding: Finding;
  onRevealPath: (path: string, side: DiffSide) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRevealPath(finding.path, finding.side)}
      title={`Show ${finding.path} — this finding was anchored at line ${finding.endLine} of an earlier commit`}
      className="w-full text-left rounded px-1.5 py-1 hover:bg-accent/40"
    >
      <div className="flex items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <span className="text-xs truncate flex-1">{finding.title}</span>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
        {fileName(finding.path)}
      </div>
    </button>
  );
}
