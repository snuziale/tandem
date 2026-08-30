import { describe, expect, it } from "vitest";
import {
  applyChecks,
  checkHeadlineOf,
  countByStatus,
  dedupeChecks,
  rollupFromRuns,
  shortCheckLabel,
} from "./checks";
import type { CheckRun, PullRequest } from "./review-types";

// Names must be DISTINCT unless a test is about the dedupe: same name is now
// the same check, and two `run("success")` would collapse into one.
let seq = 0;
function run(
  status: CheckRun["status"],
  name = `${status}-${(seq += 1)}`,
  at?: string,
): CheckRun {
  return { name, status, at };
}

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
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: null,
    viewerReviewState: null,
    checkRollup: "SUCCESS",
    checkRuns: [],
    checkTotal: 0,
    threadCount: 0,
    unresolvedThreadCount: 0,
    approvalCount: 0,
    changesRequestedCount: 0,
    commentCount: 0,
    autoMergeBy: null,
    requestedReviewers: [],
    createdAt: "2026-08-28T12:00:00Z",
    updatedAt: "2026-08-29T12:00:00Z",
    url: "https://github.com/o/r/pull/1",
    ...over,
  };
}

describe("checkHeadlineOf", () => {
  it("names a cancelled run cancelled, not failing", () => {
    // The real PR this came from: 53 contexts, 40 green, 12 skipped, and one
    // cancelled run superseded by a green re-run ten seconds later. GitHub's
    // own rollup is FAILURE, so the tone stays red — the WORD was the lie.
    const head = checkHeadlineOf(
      pr({
        checkRollup: "FAILURE",
        checkRuns: [run("cancelled"), run("success"), run("success")],
        checkTotal: 3,
      }),
    );
    expect(head).toMatchObject({
      tone: "failure",
      word: "cancelled",
      count: 1,
    });
    expect(shortCheckLabel(head)).toBe("1/3 cancelled");
  });

  it("prefers a real failure over a cancellation", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "FAILURE",
        checkRuns: [run("cancelled"), run("failure"), run("failure")],
        checkTotal: 3,
      }),
    );
    expect(head).toMatchObject({ word: "failing", count: 2 });
  });

  // GitHub says something is wrong but the window doesn't hold it. The old
  // code printed `failing || 1` — a number nothing had counted.
  it("prints no number when the rollup fails but the window is clean", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "FAILURE",
        checkRuns: [run("success"), run("success")],
        checkTotal: 40,
      }),
    );
    expect(head).toMatchObject({
      tone: "failure",
      word: "not passing",
      count: null,
    });
    expect(shortCheckLabel(head)).toBe("not passing · 40");
  });

  it("marks a windowed count as a floor", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "SUCCESS",
        checkRuns: [run("success"), run("success")],
        checkTotal: 53,
      }),
    );
    expect(head).toMatchObject({
      word: "passing",
      count: 2,
      atLeast: true,
      partial: true,
      total: 53,
    });
    expect(shortCheckLabel(head)).toBe("2+ passing");
  });

  it("counts only real passes, never neutral or skipped", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "SUCCESS",
        checkRuns: [run("success"), run("skipped"), run("neutral")],
        checkTotal: 3,
      }),
    );
    expect(head).toMatchObject({ count: 1, atLeast: false, total: 3 });
    expect(shortCheckLabel(head)).toBe("1/3 passing");
  });

  it("reports no checks for an empty rollup", () => {
    const head = checkHeadlineOf(pr({ checkRollup: "NONE" }));
    expect(head).toMatchObject({ tone: "none", count: null });
    expect(shortCheckLabel(head)).toBe("no checks");
  });

  it("never reports a total smaller than what it was handed", () => {
    // A response fetched before totalCount was queried normalizes to 0; the
    // runs in hand are still the better answer, and must not read as partial.
    const head = checkHeadlineOf(
      pr({ checkRuns: [run("success")], checkTotal: 0 }),
    );
    expect(head).toMatchObject({ total: 1, partial: false, count: 1 });
  });

  // The whole point of the dedupe, end to end: PR #3468 had 53 attempts —
  // 40 green, 12 skipped, and one cancelled `demo-exists` superseded ten
  // seconds later. GitHub's rollup still reads FAILURE because it counts the
  // superseded attempt; the latest result of every check is green.
  it("lets the latest attempt beat GitHub's rollup", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "FAILURE",
        checkRuns: [
          run("cancelled", "demo-exists", "2026-08-29T22:01:56Z"),
          run("success", "demo-exists", "2026-08-29T22:02:06Z"),
          run("success", "demo-exists", "2026-08-29T22:02:20Z"),
          run("success", "build", "2026-08-29T22:03:00Z"),
          run("skipped", "deploy", "2026-08-29T22:03:00Z"),
        ],
        checkTotal: 5,
      }),
    );
    expect(head).toMatchObject({
      tone: "success",
      word: "passing",
      count: 2,
      total: 3,
      collapsed: 2,
      rollupDisagrees: true,
    });
  });

  it("does not claim a disagreement when there is none", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "SUCCESS",
        checkRuns: [run("success", "a", "1")],
        checkTotal: 1,
      }),
    );
    expect(head).toMatchObject({ rollupDisagrees: false, collapsed: 0 });
  });

  // A fetch short of the total cannot dedupe safely — the later attempt may be
  // outside the window — so the rollup stays in charge.
  it("defers to the rollup while the fetch is short", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "FAILURE",
        checkRuns: [run("success", "a", "1"), run("success", "b", "1")],
        checkTotal: 53,
      }),
    );
    expect(head).toMatchObject({ tone: "failure", word: "not passing" });
  });

  // The queue's shape from here on: the rollup and the total are exact, the
  // per-check nodes are the detail query's job, so no count is claimed.
  it("states the total and no count when no runs were fetched", () => {
    const failing = checkHeadlineOf(
      pr({ checkRollup: "FAILURE", checkRuns: [], checkTotal: 53 }),
    );
    expect(shortCheckLabel(failing)).toBe("not passing · 53");
    const green = checkHeadlineOf(
      pr({ checkRollup: "SUCCESS", checkRuns: [], checkTotal: 53 }),
    );
    expect(shortCheckLabel(green)).toBe("passing · 53");
    const running = checkHeadlineOf(
      pr({ checkRollup: "PENDING", checkRuns: [], checkTotal: 53 }),
    );
    expect(shortCheckLabel(running)).toBe("running · 53");
  });

  it("counts pending runs while the rollup is pending", () => {
    const head = checkHeadlineOf(
      pr({
        checkRollup: "PENDING",
        checkRuns: [run("pending"), run("pending"), run("success")],
        checkTotal: 3,
      }),
    );
    expect(head).toMatchObject({ tone: "pending", word: "running", count: 2 });
  });
});

describe("dedupeChecks", () => {
  // The real shape: three attempts of one check on one commit, the cancelled
  // one first and two green re-runs seconds later.
  it("keeps the latest attempt per name", () => {
    const kept = dedupeChecks([
      run("cancelled", "demo-exists", "2026-08-29T22:01:56Z"),
      run("success", "demo-exists", "2026-08-29T22:02:06Z"),
      run("success", "demo-exists", "2026-08-29T22:02:20Z"),
      run("failure", "build", "2026-08-29T22:00:00Z"),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ name: "demo-exists", status: "success" });
    expect(kept[1]).toMatchObject({ name: "build", status: "failure" });
  });

  it("keeps the newest even when it arrives first", () => {
    const kept = dedupeChecks([
      run("success", "x", "2026-08-29T22:02:20Z"),
      run("cancelled", "x", "2026-08-29T22:01:56Z"),
    ]);
    expect(kept).toEqual([
      { name: "x", status: "success", at: "2026-08-29T22:02:20Z" },
    ]);
  });

  it("holds first-appearance order", () => {
    const kept = dedupeChecks([
      run("success", "a", "1"),
      run("success", "b", "1"),
      run("failure", "a", "2"),
    ]);
    expect(kept.map((c) => c.name)).toEqual(["a", "b"]);
  });

  // A response fetched without the timestamps: last wins, which is the same
  // convention and the only ordering left.
  it("falls back to list order without timestamps", () => {
    const kept = dedupeChecks([run("cancelled", "x"), run("success", "x")]);
    expect(kept).toEqual([{ name: "x", status: "success", at: undefined }]);
  });
});

describe("countByStatus", () => {
  it("counts one status at a time", () => {
    const runs = [run("success"), run("cancelled"), run("success")];
    expect(countByStatus(runs, "success")).toBe(2);
    expect(countByStatus(runs, "cancelled")).toBe(1);
    expect(countByStatus(runs, "failure")).toBe(0);
  });
});

describe("rollupFromRuns", () => {
  it("reads the runs the way GitHub reads attempts", () => {
    expect(rollupFromRuns([run("success", "a", "1")])).toBe("SUCCESS");
    expect(
      rollupFromRuns([run("success", "a", "1"), run("cancelled", "b", "1")]),
    ).toBe("FAILURE");
    expect(
      rollupFromRuns([run("success", "a", "1"), run("pending", "b", "1")]),
    ).toBe("PENDING");
    expect(rollupFromRuns([])).toBe("NONE");
  });
});

describe("applyChecks", () => {
  const snapshot = {
    headSha: "sha",
    checkRollup: "FAILURE" as const,
    checkTotal: 3,
    checkRuns: [
      run("cancelled", "demo", "2026-08-29T22:01:56Z"),
      run("success", "demo", "2026-08-29T22:02:20Z"),
      run("success", "build", "2026-08-29T22:02:20Z"),
    ],
  };

  // The refinement's whole job: the rollup GitHub reports counts a superseded
  // attempt, and the row must not keep saying "checks red" because of it —
  // pulse reads this same field.
  it("re-derives the rollup from the deduped runs", () => {
    const refined = applyChecks(pr({ checkRollup: "FAILURE" }), snapshot);
    expect(refined.checkRollup).toBe("SUCCESS");
    expect(refined.checkRuns).toHaveLength(3);
    expect(refined.checkTotal).toBe(3);
    expect(shortCheckLabel(checkHeadlineOf(refined))).toBe("2/2 passing");
  });

  it("refuses a snapshot from another commit", () => {
    const row = pr({ headSha: "newer", checkRollup: "FAILURE" });
    expect(applyChecks(row, snapshot)).toBe(row);
  });

  it("is a no-op without a snapshot", () => {
    const row = pr();
    expect(applyChecks(row, undefined)).toBe(row);
  });

  // A windowed snapshot cannot be deduped safely — the newest attempt may sit
  // outside it — so GitHub's own verdict stands.
  it("keeps GitHub's rollup when the snapshot is windowed", () => {
    const refined = applyChecks(pr(), { ...snapshot, checkTotal: 120 });
    expect(refined.checkRollup).toBe("FAILURE");
  });
});
