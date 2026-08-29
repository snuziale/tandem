// What the pane knows about a review it has NOT run yet.
//
// The empty state used to be a bare "Run agent" button: a spend commitment
// with nothing to weigh it against. Everything below is already in memory the
// moment the screen paints — the diff, the settings, today's spend, and every
// run record for this PR including the ones on earlier commits — so the pane
// can brief the reviewer instead of interrogating them.
//
// Two rules keep it honest. The skip prediction calls the SERVER's own
// `skipDecision` (that is why it lives in shared/), so the card can never
// promise a run the pipeline would refuse. And the prior-run summary reports
// how much of that run still points at code this commit touches, because a
// review of a different sha is evidence, not an answer.
import { skipDecision, type SkipDecision } from "../../shared/agent-decide";
import { analyzableFiles, clusterFiles } from "../../shared/agent-cluster";
import type { AgentRun, Finding } from "../../shared/agent-types";
import { countDiffLines } from "../../shared/gh/patch";
import type { FileChange, PrId, PullRequest } from "../../shared/review-types";
import { agentEnabledFor } from "../../shared/settings-types";
import type { TandemSettings } from "../../shared/settings-types";

export type Preflight = {
  /** What the pipeline would do with this PR right now. */
  decision: SkipDecision;
  /** Pass-2 invocations a run would make — the shape of the wait, and of the
   * spend. Zero means there is nothing here the agent would read. */
  passes: number;
  /** Files the agent would actually read (generated and binary dropped). */
  analyzed: number;
  /** Changed lines across the whole diff, the number the caps are set in. */
  diffLines: number;
  spentTodayUsd: number;
  dailyCostUsd: number;
};

export function preflightOf(input: {
  pr: PullRequest;
  files: readonly FileChange[];
  settings: TandemSettings;
  spentTodayUsd: number;
}): Preflight {
  const files = [...input.files];
  const readable = analyzableFiles(files);
  const diffLines = countDiffLines(files);
  const decision = skipDecision(
    {
      isDraft: input.pr.isDraft,
      // `pr.changedFiles`, NOT `files.length`. The files endpoint caps its
      // list (FILES_API_WINDOW), so on the very PRs the file cap exists for
      // the two disagree — and the card would promise a run the pipeline then
      // skips with `too-many-files`, which is exactly the guarantee this
      // module is built to make. Same input `pipeline/run.ts` passes.
      changedFiles: input.pr.changedFiles,
      diffLines,
      allGenerated: readable.length === 0,
      agentEnabled: agentEnabledFor(
        input.settings,
        `${input.pr.owner}/${input.pr.repo}`,
      ),
      spentTodayUsd: input.spentTodayUsd,
    },
    input.settings,
  );
  return {
    decision,
    passes: clusterFiles(readable).length,
    analyzed: readable.length,
    diffLines,
    spentTodayUsd: input.spentTodayUsd,
    dailyCostUsd: input.settings.dailyCostUsd,
  };
}

/**
 * A finished review of an EARLIER commit of this PR.
 *
 * The staleness sweep keeps old runs and their findings rather than deleting
 * them (spec §2) — and then nothing showed them, because the pane only ever
 * looks up the current sha. This is the record that was already loaded and
 * already paid for, sitting one lookup away.
 */
export type PriorReview = {
  run: AgentRun;
  /** The findings behind `live`/`total` — unfinished business only. Returned
   * rather than recomputed by the card, so the headline and the rows under it
   * can never be two different answers to the same question. */
  findings: Finding[];
  /** Findings whose file this commit still changes — the part worth reading.
   * A finding on a file that has since dropped out of the diff is history. */
  live: number;
  total: number;
};

/**
 * The most recent finished run on any OTHER sha of this PR. Only `ready` and
 * `stale` runs qualify: a failed or skipped run has nothing to tell you, and
 * offering it would make the card noise rather than a briefing.
 */
export function priorReviewFor(input: {
  runs: readonly AgentRun[];
  prId: PrId;
  headSha: string | undefined;
  files: readonly FileChange[];
}): PriorReview | null {
  const changed = new Set(input.files.map((f) => f.path));
  const candidates = input.runs
    .filter(
      (r) =>
        r.prId === input.prId &&
        r.headSha !== input.headSha &&
        (r.status === "ready" || r.status === "stale"),
    )
    // Newest first. `finishedAt` is what "most recently reviewed" means; a run
    // without one never finished and sorts last rather than throwing.
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  const run = candidates[0];
  if (!run) return null;
  // Dismissed findings were answered by a human; posted ones are on GitHub.
  // Neither is something to hand back as unfinished business.
  const open = run.findings.filter(
    (f) => f.state !== "dismissed" && f.state !== "posted",
  );
  return {
    run,
    findings: open,
    live: open.filter((f) => changed.has(f.path)).length,
    total: open.length,
  };
}
