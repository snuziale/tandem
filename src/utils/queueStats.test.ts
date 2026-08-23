import { describe, expect, it } from "vitest";
import type { PullRequest } from "../shared/review-types";
import {
  computeQueueStats,
  filterByFacet,
  formatFacet,
  idleBucket,
  matchesFacet,
  parseFacet,
  reviewBucket,
  sizeBucket,
} from "./queueStats";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    prId: "o/r#1",
    owner: "o",
    repo: "r",
    number: 1,
    title: "t",
    bodyMarkdown: "",
    author: "alice",
    headRef: "f",
    baseRef: "main",
    headSha: "sha",
    isDraft: false,
    state: "OPEN",
    commitCount: 1,
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    reviewDecision: null,
    checkRollup: "SUCCESS",
    checkRuns: [],
    threadCount: 0,
    unresolvedThreadCount: 0,
    createdAt: ago(1),
    updatedAt: ago(0.1),
    url: "https://example.test",
    ...over,
  };
}

describe("buckets", () => {
  it("buckets idle time on updatedAt, not createdAt", () => {
    // Opened a month ago but touched an hour ago — that's a live PR.
    const fresh = pr({ createdAt: ago(30), updatedAt: ago(0.04) });
    expect(idleBucket(fresh, NOW)).toBe("<1d");
    expect(idleBucket(pr({ updatedAt: ago(2) }), NOW)).toBe("1-3d");
    expect(idleBucket(pr({ updatedAt: ago(6.9) }), NOW)).toBe("3-7d");
    expect(idleBucket(pr({ updatedAt: ago(40) }), NOW)).toBe(">7d");
  });

  it("buckets size on total churn, at the boundaries", () => {
    expect(sizeBucket(pr({ additions: 49, deletions: 0 }))).toBe("S");
    expect(sizeBucket(pr({ additions: 25, deletions: 25 }))).toBe("M");
    expect(sizeBucket(pr({ additions: 200, deletions: 49 }))).toBe("M");
    expect(sizeBucket(pr({ additions: 250, deletions: 0 }))).toBe("L");
    expect(sizeBucket(pr({ additions: 500, deletions: 500 }))).toBe("XL");
  });

  it("lets draft outrank the review decision", () => {
    expect(
      reviewBucket(pr({ isDraft: true, reviewDecision: "APPROVED" })),
    ).toBe("draft");
    expect(reviewBucket(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe(
      "awaiting",
    );
    expect(reviewBucket(pr({ reviewDecision: null }))).toBe("none");
  });
});

describe("facets", () => {
  it("round-trips through the URL form", () => {
    for (const raw of [
      "author:alice",
      "repo:uipath/flow-workbench",
      "idle:>7d",
    ])
      expect(formatFacet(parseFacet(raw))).toBe(raw);
  });

  it("rejects a value outside a closed bucket set, but not open ones", () => {
    // A typo or a stale link must clear the filter, not silently empty the
    // queue with no explanation.
    expect(parseFacet("size:BOGUS")).toBeNull();
    expect(parseFacet("idle:8d")).toBeNull();
    expect(parseFacet("checks:green")).toBeNull();
    expect(parseFacet("review:pending")).toBeNull();
    // author/repo are open sets — any login or owner/repo is legitimate.
    expect(parseFacet("author:nobody-here")).toEqual({
      dim: "author",
      value: "nobody-here",
    });
    expect(parseFacet("repo:acme/gone")).toEqual({
      dim: "repo",
      value: "acme/gone",
    });
  });

  it("keeps colons out of the value only at the first separator", () => {
    expect(parseFacet("repo:a/b")).toEqual({ dim: "repo", value: "a/b" });
    expect(parseFacet("nope:x")).toBeNull();
    expect(parseFacet("author:")).toBeNull();
    expect(parseFacet(":alice")).toBeNull();
    expect(parseFacet(null)).toBeNull();
  });

  it("matches each dimension", () => {
    const row = pr({
      author: "bob",
      owner: "acme",
      repo: "web",
      additions: 900,
      deletions: 200,
      checkRollup: "FAILURE",
      reviewDecision: "CHANGES_REQUESTED",
      updatedAt: ago(9),
    });
    for (const raw of [
      "author:bob",
      "repo:acme/web",
      "idle:>7d",
      "size:XL",
      "checks:failing",
      "review:changes",
    ])
      expect(matchesFacet(row, parseFacet(raw)!, NOW)).toBe(true);
    expect(matchesFacet(row, parseFacet("author:alice")!, NOW)).toBe(false);
  });

  it("filters, and a null facet is the identity", () => {
    const rows = [pr({ author: "alice" }), pr({ author: "bob" })];
    expect(filterByFacet(rows, null, NOW)).toBe(rows);
    expect(filterByFacet(rows, { dim: "author", value: "bob" }, NOW)).toEqual([
      rows[1],
    ]);
  });
});

describe("computeQueueStats", () => {
  const rows = [
    pr({ author: "alice", checkRollup: "FAILURE" }),
    pr({ author: "alice", reviewDecision: "REVIEW_REQUIRED" }),
    pr({ author: "bob", repo: "web", updatedAt: ago(20) }),
    pr({ author: "cara", isDraft: true, additions: 2000, deletions: 0 }),
  ];
  const stats = computeQueueStats(rows, NOW);

  it("sorts nominal slices by count desc", () => {
    expect(stats.authors.slices.map((s) => [s.key, s.value])).toEqual([
      ["alice", 2],
      ["bob", 1],
      ["cara", 1],
    ]);
    expect(stats.authors.hidden).toBe(0);
    expect(stats.repos.slices.map((s) => s.key)).toEqual(["o/r", "o/web"]);
  });

  it("folds the nominal tail past the bar limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      pr({ author: `u${i}`, prId: `o/r#${i}` }),
    );
    const s = computeQueueStats(many, NOW);
    expect(s.authors.slices).toHaveLength(6);
    expect(s.authors.hidden).toBe(4);
    expect(s.authors.distinct).toBe(10);
  });

  it("keeps empty ordinal buckets and drops empty status segments", () => {
    expect(stats.idle.map((s) => [s.key, s.value])).toEqual([
      ["<1d", 3],
      ["1-3d", 0],
      ["3-7d", 0],
      [">7d", 1],
    ]);
    expect(stats.checks.map((s) => s.key)).toEqual(["passing", "failing"]);
    expect(stats.review.map((s) => s.key)).toEqual([
      "awaiting",
      "draft",
      "none",
    ]);
  });

  it("derives the headline counts", () => {
    expect(stats.total).toBe(4);
    expect(stats.awaiting).toBe(1);
    expect(stats.failing).toBe(1);
    expect(stats.idleOverWeek).toBe(1);
    expect(stats.totalChurn).toBe(15 + 15 + 15 + 2000);
  });

  it("is empty-safe", () => {
    const empty = computeQueueStats([], NOW);
    expect(empty.total).toBe(0);
    expect(empty.checks).toEqual([]);
    expect(empty.idle.every((s) => s.value === 0)).toBe(true);
  });
});
