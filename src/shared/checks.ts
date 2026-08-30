// CHECKS — one honest sentence about a PR's CI, for the two surfaces that
// print one.
//
// The queue cell and the detail chip both counted `pr.checkRuns` themselves,
// and both were wrong in the same two ways. The list was a WINDOW — the query
// asked for the first 20 or 30 contexts and a real repo had 53 — so "18
// passing" was a count of what we fetched, not of the PR; and `cancelled` was
// normalized to `failure`, so a run superseded by a green re-run ten seconds
// later rendered as "1 failing" in red on a PR GitHub lists as cancelled.
//
// Both are one mistake: printing a number the data does not support. So the
// rules live here, once, and the two surfaces differ only in how much room
// they have. The QUEUE now has no per-check nodes at all (they cost half its
// latency — see queueQuery.ts), which this handles as the general case it
// already had to handle: no runs to count, so no number is claimed.
import type {
  CheckRollup,
  CheckRun,
  ChecksSnapshot,
  PullRequest,
} from "./review-types";

export type CheckTone = "failure" | "pending" | "success" | "none";

export type CheckHeadline = {
  /** Which status token the line wears. Follows GitHub's OWN rollup, never a
   * count: the rollup is GitHub's verdict and the window may not contain the
   * run that produced it. */
  tone: CheckTone;
  /** The word: "failing", "cancelled", "running", "passing", "no checks". */
  word: string;
  /** How many, or null when the window supports no number at all. */
  count: number | null;
  /** `count` is a floor, not a total — render it as "n+". True exactly when
   * the fetched window is smaller than what GitHub has. */
  atLeast: boolean;
  /** What GitHub has on the head commit. */
  total: number;
  /** The window is short of `total`; every count here is a lower bound. */
  partial: boolean;
  /** Re-run attempts folded away by `dedupeChecks`. */
  collapsed: number;
  /** The tone here is not the one GitHub's rollup implies — which happens
   * exactly when the rollup is still counting a superseded attempt. The
   * detail pane says so out loud, because github.com shows the rollup. */
  rollupDisagrees: boolean;
};

/**
 * One entry per check NAME, keeping the LATEST result.
 *
 * A commit collects a run per workflow attempt, so the same check can appear
 * three times — `demo-exists` on a real PR was CANCELLED, then SUCCESS ten
 * seconds later, then SUCCESS again. All three are attached to the head
 * commit, so every raw count is a count of ATTEMPTS, and the cancelled one
 * dragged the whole PR red long after it had been superseded. The name is the
 * right key: it is what branch protection matches a required check on, so it
 * is GitHub's own identity for "the same check".
 *
 * Order is first-appearance, not recency — the list this feeds is sorted by
 * status anyway, and a stable order keeps the popover from reshuffling as
 * re-runs land. `at` is ISO-8601 and compares as a string; a response that
 * didn't fetch it (or a tie) falls back to LAST wins, which is the same
 * convention and the only ordering information left.
 */
export function dedupeChecks(runs: readonly CheckRun[]): CheckRun[] {
  const bestAt = new Map<string, string>();
  const kept = new Map<string, CheckRun>();
  for (const run of runs) {
    const at = run.at ?? "";
    const seen = bestAt.get(run.name);
    if (seen !== undefined && at < seen) continue;
    bestAt.set(run.name, at);
    kept.set(run.name, run);
  }
  return [...kept.values()];
}

export function countByStatus(
  runs: readonly CheckRun[],
  status: CheckRun["status"],
): number {
  let n = 0;
  for (const run of runs) if (run.status === status) n += 1;
  return n;
}

/** GitHub's rollup, as a tone. It counts every ATTEMPT on the commit, which
 * is why it can disagree with the deduped runs. */
function toneOfRollup(rollup: PullRequest["checkRollup"]): CheckTone {
  if (rollup === "NONE") return "none";
  if (rollup === "FAILURE") return "failure";
  if (rollup === "PENDING") return "pending";
  return "success";
}

/** What the runs themselves say, worst first. Null when there are none. */
function readRuns(
  runs: readonly CheckRun[],
): { tone: CheckTone; word: string; count: number | null } | null {
  if (runs.length === 0) return null;
  const failing = countByStatus(runs, "failure");
  if (failing > 0) return { tone: "failure", word: "failing", count: failing };
  const cancelled = countByStatus(runs, "cancelled");
  if (cancelled > 0)
    return { tone: "failure", word: "cancelled", count: cancelled };
  const pending = countByStatus(runs, "pending");
  if (pending > 0) return { tone: "pending", word: "running", count: pending };
  // Only `success` counts as passing — neutral and skipped are green in the
  // rollup but are not runs that passed, and lumping them in is how "18
  // passing" gets printed about 6 that ran.
  const passing = countByStatus(runs, "success");
  return { tone: "success", word: "passing", count: passing || null };
}

/**
 * One line about a PR's CI: a tone, a word, and a number only when something
 * counted it.
 *
 * WHERE IT READS FROM depends on what was fetched, and that is the whole
 * design. With the complete set of runs in hand (the detail query) THEY
 * decide, deduped to the latest attempt per name — that is what "latest result
 * wins" means, and deferring to GitHub's rollup would undo it, since the
 * rollup counts a cancelled attempt a green re-run replaced ten seconds later.
 * With no runs (the queue asks for none) or a short fetch, the rollup is all
 * there is, and it is reported as the coarser thing it is: "not passing"
 * rather than "failing", because the cause is a run we cannot see.
 *
 * `rollupDisagrees` marks the gap instead of hiding it — github.com shows the
 * rollup, so a reader comparing the two is owed the reason.
 */
export function checkHeadlineOf(pr: PullRequest): CheckHeadline {
  const runs = dedupeChecks(pr.checkRuns);
  // `checkTotal` counts ATTEMPTS (GitHub's totalCount over the rollup's
  // contexts). Once the runs are in hand and complete, the deduped length is
  // the better total — 53 attempts were 47 checks — and while the fetch is
  // short of them, attempts are all there is to report.
  const partial = pr.checkRuns.length < pr.checkTotal;
  const total = partial ? Math.max(pr.checkTotal, runs.length) : runs.length;
  const collapsed = pr.checkRuns.length - runs.length;
  const rollupTone = toneOfRollup(pr.checkRollup);

  const line = (
    tone: CheckTone,
    word: string,
    count: number | null,
  ): CheckHeadline => ({
    tone,
    word,
    count,
    atLeast: count !== null && partial,
    total,
    partial,
    collapsed,
    rollupDisagrees: tone !== rollupTone,
  });

  if (rollupTone === "none" || total === 0)
    return line("none", "no checks", null);

  // The runs are authoritative once they are all here.
  const read = partial ? null : readRuns(runs);
  if (read) return line(read.tone, read.word, read.count);

  if (rollupTone === "failure") {
    const failing = countByStatus(runs, "failure");
    if (failing > 0) return line("failure", "failing", failing);
    const cancelled = countByStatus(runs, "cancelled");
    if (cancelled > 0) return line("failure", "cancelled", cancelled);
    return line("failure", "not passing", null);
  }
  if (rollupTone === "pending") {
    const pending = countByStatus(runs, "pending");
    return line("pending", "running", pending || null);
  }
  const passing = countByStatus(runs, "success");
  return line("success", "passing", passing || null);
}

/**
 * The queue column: as short as it can be while staying true.
 *
 * With no runs to count the word stands alone and the TOTAL rides beside it —
 * "passing · 53" is exact, and it is the same number github.com prints, which
 * "18 passing" was not.
 */
export function shortCheckLabel(head: CheckHeadline): string {
  if (head.tone === "none") return head.word;
  // No runs to count (the queue before its refinement lands): the word and the
  // exact total, which are the two things that ARE known.
  if (head.count === null)
    return head.total > 0 ? `${head.word} · ${head.total}` : head.word;
  // Windowed: a floor, never a ratio — the denominator would be a different
  // number's denominator.
  if (head.atLeast) return `${head.count}+ ${head.word}`;
  // The same claim the detail chip makes ("35 of 47 checks passing"), in the
  // width a column has. Matching wording is the point: one row must not say
  // two different things about one PR.
  return `${head.count}/${head.total} ${head.word}`;
}

/**
 * The rollup the deduped runs imply.
 *
 * GitHub's own rollup counts every ATTEMPT, so it stays FAILURE for a
 * cancelled run a re-run replaced. Once the complete set of runs is in hand,
 * this is the rollup that matches what the runs say — and it matters beyond
 * the checks cell, because pulse's `blockedOn` reads `checkRollup` to decide
 * whether the ball is with the author. A row saying "checks passing" beside
 * "blocked on you — checks red" is the same contradiction one column over.
 */
export function rollupFromRuns(runs: readonly CheckRun[]): CheckRollup {
  if (runs.length === 0) return "NONE";
  if (
    countByStatus(runs, "failure") > 0 ||
    countByStatus(runs, "cancelled") > 0
  )
    return "FAILURE";
  if (countByStatus(runs, "pending") > 0) return "PENDING";
  return "SUCCESS";
}

/**
 * Fold a refinement into a queue row.
 *
 * Refused unless the snapshot was taken on the SAME head commit — a queue
 * poll and the checks request race, and applying yesterday's runs to today's
 * commit is worse than showing no runs at all. The rollup is only re-derived
 * when the snapshot is complete; a windowed one cannot be deduped safely, so
 * GitHub's own answer stands.
 */
export function applyChecks(
  pr: PullRequest,
  snapshot: ChecksSnapshot | undefined,
): PullRequest {
  if (!snapshot || snapshot.headSha !== pr.headSha) return pr;
  const partial = snapshot.checkRuns.length < snapshot.checkTotal;
  return {
    ...pr,
    checkRollup: partial
      ? snapshot.checkRollup
      : rollupFromRuns(dedupeChecks(snapshot.checkRuns)),
    checkRuns: snapshot.checkRuns,
    checkTotal: snapshot.checkTotal,
  };
}
