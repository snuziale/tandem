// PULSE — whose court the ball is in.
//
// The queue answers "what must I review?". A cohort view answers a different
// question: "how is my team's work doing?" — and the useful answer there is
// not a count, it's a DIRECTION. Six approvals and three comments tell you
// nothing on their own; "nobody can move this until the author pushes" does.
//
// So every PR resolves to exactly one attention state, from facts the queue
// search already returns. Pure and runtime-neutral (shared/, not utils/): the
// queue rows, the stats drawer and the /api/pulse menu-bar feed all have to
// agree about what "rotting" means, and the server needs it as much as the
// client does.
import type { PullRequest } from "./review-types";

/** Display order, worst-for-you first: what you must act on, then what is
 * dying, then what is someone else's problem, then what is fine. */
export const PULSE_STATES = [
  "blocked-on-you",
  "rotting",
  "blocked-on-them",
  "ready",
  "moving",
] as const;

export type PulseState = (typeof PULSE_STATES)[number];

/**
 * The three worth promoting out of the five, wherever something has room for
 * only a few: the header pill's segments and the drawer's trend lines.
 *
 * `blocked-on-them` and `moving` are by definition not your problem, and the
 * drawer's strip has the full breakdown — so these are the ones whose
 * DIRECTION is a decision: your queue growing, rot accumulating, merges piling
 * up unmerged. One editorial judgement, one place.
 */
export const PULSE_HEADLINE_STATES = [
  "blocked-on-you",
  "rotting",
  "ready",
] as const satisfies readonly PulseState[];

export const PULSE_LABELS: Record<PulseState, string> = {
  "blocked-on-you": "blocked on you",
  rotting: "rotting",
  "blocked-on-them": "blocked on them",
  ready: "ready to merge",
  moving: "moving",
};

/** One line each, shown under the chart and in the xbar menu. */
export const PULSE_HINTS: Record<PulseState, string> = {
  "blocked-on-you": "your review is what it is waiting for",
  rotting: "nobody has touched it in a while",
  "blocked-on-them": "the author has to act — changes requested or checks red",
  ready: "approved and green; someone just has to merge it",
  moving: "in flight — drafts and freshly-pushed work",
};

const DAY = 24 * 60 * 60 * 1000;

/** Default staleness line, matching the xbar script this grew out of. */
export const DEFAULT_ROTTING_DAYS = 7;

export type PulseOptions = {
  now: number;
  /** The authenticated login. Without it nothing is ever "blocked on you" —
   * an honest degradation, not a guess. */
  viewerLogin?: string | null;
  rottingDays?: number;
};

export function idleDaysOf(pr: PullRequest, now: number): number {
  const then = new Date(pr.updatedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / DAY);
}

export function isApproved(pr: PullRequest): boolean {
  return pr.reviewDecision === "APPROVED" || pr.approvalCount > 0;
}

/**
 * Which side has to move next, ignoring who you are.
 *
 * AUTHOR side is the strong signal: changes were requested, or checks are red.
 * Either way no reviewer can do anything until the branch changes.
 *
 * REVIEWER side is the weaker one: somebody has been asked and hasn't
 * answered. `reviewDecision` alone is not enough — it is null on any base
 * branch without a required-reviews rule (see cells.tsx) — so an outstanding
 * review REQUEST counts too.
 *
 * Null means neither: approved and green, or open with nothing asked of anyone
 * yet.
 */
export function blockedOn(pr: PullRequest): "author" | "reviewer" | null {
  if (
    pr.changesRequestedCount > 0 ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.checkRollup === "FAILURE"
  )
    return "author";
  if (isApproved(pr)) return null;
  if (
    pr.requestedReviewers.length > 0 ||
    pr.reviewDecision === "REVIEW_REQUIRED"
  )
    return "reviewer";
  return null;
}

/** You are one of the people it is waiting on. A team request can't be
 * resolved to a membership here, so it never counts as yours. */
export function awaitsViewer(
  pr: PullRequest,
  viewerLogin: string | null | undefined,
): boolean {
  if (!viewerLogin) return false;
  if (pr.author === viewerLogin) return false;
  if (pr.viewerReviewState === "APPROVED") return false;
  return pr.requestedReviewers.includes(viewerLogin);
}

/**
 * The one state a PR is in. Order is the whole design:
 *
 *  1. A draft is always `moving` — it is the author's sketchpad, and the xbar
 *     script this came from is right that staleness does not apply to it.
 *  2. Your own action outranks everything else. This is a review client.
 *  3. `ready` beats `rotting`: an approved, green PR sitting for two weeks is
 *     not rotting, it is waiting for a merge click, and calling that "rotting"
 *     buries the one row somebody can close out in a second.
 *  4. Then rot, because "three weeks untouched" is the story, not the
 *     changes-requested that started it.
 */
export function pulseStateOf(pr: PullRequest, opts: PulseOptions): PulseState {
  const rottingDays = opts.rottingDays ?? DEFAULT_ROTTING_DAYS;
  if (pr.isDraft) return "moving";

  const side = blockedOn(pr);
  const mine =
    side === "author"
      ? pr.author === opts.viewerLogin
      : awaitsViewer(pr, opts.viewerLogin);
  if (mine) return "blocked-on-you";

  if (side === null && isApproved(pr) && pr.checkRollup !== "FAILURE")
    return "ready";
  if (idleDaysOf(pr, opts.now) >= rottingDays) return "rotting";
  if (side) return "blocked-on-them";
  return "moving";
}

export type PulseCounts = Record<PulseState, number>;

export function emptyPulseCounts(): PulseCounts {
  return {
    "blocked-on-you": 0,
    rotting: 0,
    "blocked-on-them": 0,
    ready: 0,
    moving: 0,
  };
}

export function pulseCounts(
  rows: readonly PullRequest[],
  opts: PulseOptions,
): PulseCounts {
  const counts = emptyPulseCounts();
  for (const pr of rows) counts[pulseStateOf(pr, opts)] += 1;
  return counts;
}

/** Auto-merge armed and only checks in the way — worth its own mark on a row,
 * but never its own pulse state: it is a property of a PR, not a court. */
export function isAutoMerging(pr: PullRequest): boolean {
  return pr.autoMergeBy !== null;
}

// ── Grouping (menu-bar feed only) ─────────────────────────────────────────
//
// The xbar script's real shape was never a flat list — it was sections, each
// with its work under it, because a menu you pull down has no columns to read
// across. The QUEUE TABLE is deliberately flat and stays that way: it is a
// worklist, its columns already carry the grouping dimensions, and the pulse
// pill slices it faster than a grouping control would. So this is here for
// shared/xbar.ts and nothing else.

export const GROUP_DIMS = ["none", "pulse", "author", "repo"] as const;
export type GroupDim = (typeof GROUP_DIMS)[number];

export type PrGroup = {
  key: string;
  label: string;
  rows: PullRequest[];
};

export function isGroupDim(
  value: string | null | undefined,
): value is GroupDim {
  return !!value && (GROUP_DIMS as readonly string[]).includes(value);
}

/** Most recently touched first — the only ordering any pulse surface uses. */
export function byUpdatedDesc(a: PullRequest, b: PullRequest): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * One row per PR, in the order they arrived — first-seen wins.
 *
 * Two callers need exactly this and for the same reason: team shards overlap
 * (a PR authored by one member and requested from another), and the menu-bar
 * feed folds several views into one list. Either way the same PR arriving
 * twice is one PR.
 *
 * It does NOT sort. It used to end in `byUpdatedDesc`, which silently
 * overrode GitHub's ordering for every queue view — including the single-shard
 * ones where the dedupe is a no-op — so a `sort:` qualifier in a view's query
 * could never reach the table. Worse, the page window is chosen by GitHub in
 * ITS order and only then re-sorted here, so the queue showed the 50
 * newest-CREATED PRs ordered by newest-TOUCHED: a PR opened last month and
 * updated a minute ago was absent entirely. Callers that genuinely merge
 * unordered lists sort for themselves with `byUpdatedDesc`.
 */
export function dedupePrs(rows: Iterable<PullRequest>): PullRequest[] {
  const seen = new Map<string, PullRequest>();
  for (const pr of rows) if (!seen.has(pr.prId)) seen.set(pr.prId, pr);
  return [...seen.values()];
}

/**
 * Ordering per dimension, and each one is a judgement:
 *  - pulse keeps PULSE_STATES order (worst-for-you first) and drops empty
 *    courts — an empty heading is a row of nothing.
 *  - author puts YOU first, then whoever pushed most recently. That is the
 *    xbar script's order, and it is right: your own work is the group you
 *    scan for, and after that recency is the only ranking that isn't a
 *    popularity contest.
 *  - repo goes by volume, ties by name, because repo is a place and the busy
 *    ones are what you are looking for.
 */
export function groupPullRequests(
  rows: readonly PullRequest[],
  dim: GroupDim,
  opts: PulseOptions,
): PrGroup[] {
  if (dim === "none")
    return [{ key: "all", label: "all", rows: [...rows].sort(byUpdatedDesc) }];

  const buckets = new Map<string, PullRequest[]>();
  const keyOf = (pr: PullRequest) =>
    dim === "pulse"
      ? pulseStateOf(pr, opts)
      : dim === "author"
        ? pr.author
        : `${pr.owner}/${pr.repo}`;
  for (const pr of rows) {
    const key = keyOf(pr);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(pr);
    else buckets.set(key, [pr]);
  }
  for (const bucket of buckets.values()) bucket.sort(byUpdatedDesc);

  if (dim === "pulse") {
    return PULSE_STATES.filter((s) => buckets.has(s)).map((s) => ({
      key: s,
      label: PULSE_LABELS[s],
      rows: buckets.get(s) ?? [],
    }));
  }

  const entries = [...buckets.entries()];
  if (dim === "author") {
    const viewer = opts.viewerLogin ?? null;
    entries.sort((a, b) => {
      if (a[0] === viewer) return -1;
      if (b[0] === viewer) return 1;
      return byUpdatedDesc(a[1][0], b[1][0]) || a[0].localeCompare(b[0]);
    });
  } else {
    entries.sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  }
  return entries.map(([key, group]) => ({ key, label: key, rows: group }));
}
