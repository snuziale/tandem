// Pure stats over the ACTIVE VIEW's rows — the queue's stats drawer and its
// click-to-filter facets. No I/O, no React: bucketing, counting and facet
// matching are the whole feature's logic, so they live here and are tested.
//
// Two rules the drawer depends on:
//  - Buckets are ORDINAL where the order carries meaning (idle time, size) and
//    NOMINAL where it doesn't (author, repo). The drawer paints them with
//    different color jobs, so the distinction is part of the data model.
//  - Stats are always computed over the UNFILTERED rows. Clicking a bar filters
//    the table, never the charts — a chart that collapses to its own selection
//    can't be used to pick the next slice.
import type { PullRequest } from "../shared/review-types";

const DAY = 24 * 60 * 60 * 1000;

/** How many bars a nominal list shows before the tail folds into "+n more". */
export const NOMINAL_LIMIT = 6;

export const IDLE_BUCKETS = ["<1d", "1-3d", "3-7d", ">7d"] as const;
export const SIZE_BUCKETS = ["S", "M", "L", "XL"] as const;
export const CHECK_BUCKETS = ["passing", "pending", "failing", "none"] as const;
export const REVIEW_BUCKETS = [
  "awaiting",
  "changes",
  "approved",
  "draft",
  "none",
] as const;

export type IdleBucket = (typeof IDLE_BUCKETS)[number];
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
export type CheckBucket = (typeof CHECK_BUCKETS)[number];
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];

/** Idle, not open-age: it's what the queue's age cell already colors on, and
 * "nobody has touched this in three weeks" is the actionable number. */
export function idleBucket(pr: PullRequest, now: number): IdleBucket {
  const days = (now - new Date(pr.updatedAt).getTime()) / DAY;
  if (days < 1) return "<1d";
  if (days < 3) return "1-3d";
  if (days < 7) return "3-7d";
  return ">7d";
}

export function churnOf(pr: PullRequest): number {
  return pr.additions + pr.deletions;
}

export function sizeBucket(pr: PullRequest): SizeBucket {
  const churn = churnOf(pr);
  if (churn < 50) return "S";
  if (churn < 250) return "M";
  if (churn < 1000) return "L";
  return "XL";
}

export function checkBucket(pr: PullRequest): CheckBucket {
  switch (pr.checkRollup) {
    case "SUCCESS":
      return "passing";
    case "PENDING":
      return "pending";
    case "FAILURE":
      return "failing";
    default:
      return "none";
  }
}

/** Draft outranks the review decision — it's what the row's badge shows too. */
export function reviewBucket(pr: PullRequest): ReviewBucket {
  if (pr.isDraft) return "draft";
  switch (pr.reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes";
    case "REVIEW_REQUIRED":
      return "awaiting";
    default:
      return "none";
  }
}

// ── Facets ────────────────────────────────────────────────────────────────

export const FACET_DIMS = [
  "author",
  "repo",
  "idle",
  "size",
  "checks",
  "review",
] as const;
export type FacetDim = (typeof FACET_DIMS)[number];
export type Facet = { dim: FacetDim; value: string };

/** `?by=author:alice`. Values never contain a colon (logins, `owner/repo`,
 * and the fixed bucket keys), so the first colon is always the separator. */
export function parseFacet(raw: string | null | undefined): Facet | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const dim = raw.slice(0, at);
  const value = raw.slice(at + 1);
  if (!value) return null;
  return (FACET_DIMS as readonly string[]).includes(dim)
    ? { dim: dim as FacetDim, value }
    : null;
}

export function formatFacet(facet: Facet | null): string | null {
  return facet ? `${facet.dim}:${facet.value}` : null;
}

export function sameFacet(a: Facet | null, b: Facet | null): boolean {
  return a?.dim === b?.dim && a?.value === b?.value;
}

export function matchesFacet(
  pr: PullRequest,
  facet: Facet,
  now: number,
): boolean {
  switch (facet.dim) {
    case "author":
      return pr.author === facet.value;
    case "repo":
      return `${pr.owner}/${pr.repo}` === facet.value;
    case "idle":
      return idleBucket(pr, now) === facet.value;
    case "size":
      return sizeBucket(pr) === facet.value;
    case "checks":
      return checkBucket(pr) === facet.value;
    case "review":
      return reviewBucket(pr) === facet.value;
  }
}

export function filterByFacet(
  rows: PullRequest[],
  facet: Facet | null,
  now: number,
): PullRequest[] {
  return facet ? rows.filter((pr) => matchesFacet(pr, facet, now)) : rows;
}

const FACET_LABELS: Record<FacetDim, string> = {
  author: "author",
  repo: "repo",
  idle: "idle",
  size: "size",
  checks: "checks",
  review: "review",
};

export function facetLabel(facet: Facet): string {
  return `${FACET_LABELS[facet.dim]}: ${facet.value}`;
}

// ── Stats ─────────────────────────────────────────────────────────────────

export type Slice = { key: string; label: string; value: number };

export type QueueStats = {
  total: number;
  /** Top-N authors by PR count, plus how many authors the tail hides. */
  authors: { slices: Slice[]; hidden: number; distinct: number };
  repos: { slices: Slice[]; hidden: number; distinct: number };
  /** Fixed-order ordinal buckets — empty ones are kept so the ramp reads. */
  idle: Slice[];
  size: Slice[];
  /** Fixed-order status buckets; empty ones are DROPPED (a zero-width segment
   * of a stacked strip is invisible but still eats a 2px gap). */
  checks: Slice[];
  review: Slice[];
  /** Headline counts, each one also a facet the tiles link to. */
  awaiting: number;
  failing: number;
  idleOverWeek: number;
  totalChurn: number;
};

function tally<T extends string>(
  rows: PullRequest[],
  of: (pr: PullRequest) => T,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const pr of rows) {
    const key = of(pr);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Nominal dimension → bars sorted by count desc, ties broken by key so the
 * order never shuffles between polls. */
function topSlices(counts: Map<string, number>, limit: number) {
  const all = [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return {
    slices: all.slice(0, limit),
    hidden: Math.max(0, all.length - limit),
    distinct: all.length,
  };
}

function orderedSlices<T extends string>(
  counts: Map<T, number>,
  order: readonly T[],
  { dropEmpty = false } = {},
): Slice[] {
  return order
    .map((key) => ({ key, label: key, value: counts.get(key) ?? 0 }))
    .filter((s) => !dropEmpty || s.value > 0);
}

export function computeQueueStats(
  rows: PullRequest[],
  now: number,
): QueueStats {
  const idle = tally(rows, (pr) => idleBucket(pr, now));
  const checks = tally(rows, checkBucket);
  const review = tally(rows, reviewBucket);
  return {
    total: rows.length,
    authors: topSlices(
      tally(rows, (pr) => pr.author),
      NOMINAL_LIMIT,
    ),
    repos: topSlices(
      tally(rows, (pr) => `${pr.owner}/${pr.repo}`),
      NOMINAL_LIMIT,
    ),
    idle: orderedSlices(idle, IDLE_BUCKETS),
    size: orderedSlices(tally(rows, sizeBucket), SIZE_BUCKETS),
    checks: orderedSlices(checks, CHECK_BUCKETS, { dropEmpty: true }),
    review: orderedSlices(review, REVIEW_BUCKETS, { dropEmpty: true }),
    awaiting: review.get("awaiting") ?? 0,
    failing: checks.get("failing") ?? 0,
    idleOverWeek: idle.get(">7d") ?? 0,
    totalChurn: rows.reduce((sum, pr) => sum + churnOf(pr), 0),
  };
}
