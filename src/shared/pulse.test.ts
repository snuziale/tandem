import { describe, expect, it } from "vitest";
import {
  blockedOn,
  isApproved,
  pulseOf,
  reviewStandingOf,
  dedupePrs,
  groupPullRequests,
  pulseCounts,
  pulseStateOf,
} from "./pulse";
import type { PullRequest } from "./review-types";

const NOW = Date.parse("2026-08-27T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    prId: "acme/web#1",
    owner: "acme",
    repo: "web",
    number: 1,
    title: "Something",
    bodyMarkdown: "",
    author: "alice",
    headRef: "feat/x",
    baseRef: "main",
    headSha: "abc",
    isDraft: false,
    state: "OPEN",
    commitCount: 1,
    additions: 10,
    deletions: 2,
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
    createdAt: "2026-08-26T12:00:00Z",
    updatedAt: "2026-08-27T11:00:00Z",
    url: "https://github.com/acme/web/pull/1",
    ...overrides,
  };
}

const opts = { now: NOW, viewerLogin: "me", rottingDays: 7 };

describe("blockedOn", () => {
  it("puts changes-requested on the author", () => {
    expect(blockedOn(pr({ changesRequestedCount: 1 }))).toBe("author");
    expect(blockedOn(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
      "author",
    );
  });

  it("puts red checks on the author too — no reviewer can move it", () => {
    expect(blockedOn(pr({ checkRollup: "FAILURE" }))).toBe("author");
  });

  // reviewDecision is null on any base branch without a required-reviews rule,
  // so an outstanding REQUEST has to count on its own.
  it("puts an outstanding request on the reviewer even with a null decision", () => {
    expect(blockedOn(pr({ requestedReviewers: ["bob"] }))).toBe("reviewer");
  });

  it("is nobody's when it is approved and green", () => {
    expect(blockedOn(pr({ approvalCount: 1 }))).toBe(null);
  });

  // CODEOWNERS: a teammate approved, the required reviewer has not, so
  // GitHub still says REVIEW_REQUIRED. The count must not overrule it.
  it("keeps a required review outstanding despite an approval", () => {
    expect(
      blockedOn(pr({ approvalCount: 1, reviewDecision: "REVIEW_REQUIRED" })),
    ).toBe("reviewer");
  });

  it("author-side wins over reviewer-side", () => {
    expect(
      blockedOn(pr({ changesRequestedCount: 1, requestedReviewers: ["bob"] })),
    ).toBe("author");
  });
});

describe("isApproved", () => {
  it("takes the decision when GitHub computed one", () => {
    expect(isApproved(pr({ reviewDecision: "APPROVED" }))).toBe(true);
    expect(
      isApproved(pr({ reviewDecision: "REVIEW_REQUIRED", approvalCount: 3 })),
    ).toBe(false);
  });

  // The fallback that exists for repos with no branch protection, where the
  // decision stays null however many approvals a PR has.
  it("falls back to the count only when there is no decision", () => {
    expect(isApproved(pr({ approvalCount: 1 }))).toBe(true);
    expect(isApproved(pr())).toBe(false);
  });
});

describe("reviewStandingOf", () => {
  it("takes GitHub's decision whenever there is one", () => {
    expect(reviewStandingOf(pr({ reviewDecision: "APPROVED" }))).toBe(
      "approved",
    );
    expect(reviewStandingOf(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
      "changes-requested",
    );
    expect(reviewStandingOf(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe(
      "awaiting",
    );
  });

  // The bug this function was extracted for: a teammate's approval on a base
  // branch with no required-reviews rule. The pulse column read the count and
  // said "ready to merge"; the badge read the decision and said "No review".
  it("reads the counts when the decision is null", () => {
    expect(reviewStandingOf(pr({ approvalCount: 1 }))).toBe("approved");
    expect(reviewStandingOf(pr({ changesRequestedCount: 1 }))).toBe(
      "changes-requested",
    );
    expect(reviewStandingOf(pr())).toBe("none");
  });

  it("lets a change request beat a stale approving review", () => {
    expect(
      reviewStandingOf(pr({ approvalCount: 1, changesRequestedCount: 1 })),
    ).toBe("changes-requested");
  });

  it("never lets a count beat an explicit REVIEW_REQUIRED", () => {
    expect(
      reviewStandingOf(
        pr({ reviewDecision: "REVIEW_REQUIRED", approvalCount: 3 }),
      ),
    ).toBe("awaiting");
  });
});

describe("pulseStateOf", () => {
  it("calls a draft moving, however old", () => {
    expect(
      pulseStateOf(
        pr({
          isDraft: true,
          updatedAt: new Date(NOW - 60 * DAY).toISOString(),
        }),
        opts,
      ),
    ).toBe("moving");
  });

  it("blames you when the request is yours", () => {
    expect(pulseStateOf(pr({ requestedReviewers: ["me"] }), opts)).toBe(
      "blocked-on-you",
    );
  });

  it("blames you for your OWN PR when the author has to act", () => {
    expect(
      pulseStateOf(pr({ author: "me", changesRequestedCount: 1 }), opts),
    ).toBe("blocked-on-you");
  });

  it("never blames you for a team request it cannot resolve", () => {
    expect(
      pulseStateOf(pr({ requestedReviewers: ["acme/web-team"] }), opts),
    ).toBe("blocked-on-them");
  });

  it("stops blaming you once you have approved", () => {
    expect(
      pulseStateOf(
        pr({
          requestedReviewers: ["me"],
          viewerReviewState: "APPROVED",
          approvalCount: 1,
        }),
        opts,
      ),
    ).toBe("ready");
  });

  // The ordering decision: an approved, green PR nobody merged is READY, not
  // rotting — it is the row someone can close out in a second.
  it("prefers ready over rotting", () => {
    expect(
      pulseStateOf(
        pr({
          approvalCount: 2,
          updatedAt: new Date(NOW - 20 * DAY).toISOString(),
        }),
        opts,
      ),
    ).toBe("ready");
  });

  // Your own PR, one teammate's approval, codeowners still owed: it is NOT
  // ready to merge, and calling it that hides the one thing still needed.
  it("does not call a PR awaiting codeowners ready", () => {
    expect(
      pulseStateOf(
        pr({
          author: "me",
          approvalCount: 1,
          reviewDecision: "REVIEW_REQUIRED",
        }),
        opts,
      ),
    ).toBe("blocked-on-them");
  });

  it("calls a long-silent changes-requested PR rotting, not blocked", () => {
    expect(
      pulseStateOf(
        pr({
          changesRequestedCount: 1,
          updatedAt: new Date(NOW - 20 * DAY).toISOString(),
        }),
        opts,
      ),
    ).toBe("rotting");
  });

  it("respects the configured rotting line", () => {
    const stale = pr({ updatedAt: new Date(NOW - 10 * DAY).toISOString() });
    expect(pulseStateOf(stale, { ...opts, rottingDays: 7 })).toBe("rotting");
    expect(pulseStateOf(stale, { ...opts, rottingDays: 30 })).toBe("moving");
  });

  it("attributes nothing to you without a login", () => {
    expect(pulseStateOf(pr({ requestedReviewers: ["me"] }), { now: NOW })).toBe(
      "blocked-on-them",
    );
  });
});

describe("pulseOf", () => {
  // The whole point: `blocked-on-you` has two entrances, and the flat hint
  // table told the author of a red-checked PR that their own review was what
  // it was waiting for.
  it("says WHICH door a blocked-on-you PR came in by", () => {
    expect(pulseOf(pr({ requestedReviewers: ["me"] }), opts).reason).toBe(
      "your-review",
    );
    expect(
      pulseOf(pr({ author: "me", checkRollup: "FAILURE" }), opts).reason,
    ).toBe("your-branch");
    expect(
      pulseOf(pr({ author: "me", changesRequestedCount: 1 }), opts).reason,
    ).toBe("your-branch");
  });

  it("gives a hint that matches the reason", () => {
    expect(
      pulseOf(pr({ author: "me", checkRollup: "FAILURE" }), opts).hint,
    ).not.toContain("your review");
    expect(pulseOf(pr({ requestedReviewers: ["me"] }), opts).hint).toContain(
      "your review",
    );
  });

  it("has no reason for any other state", () => {
    expect(pulseOf(pr({ approvalCount: 1 }), opts)).toMatchObject({
      state: "ready",
      reason: null,
    });
    expect(pulseOf(pr({ isDraft: true }), opts).reason).toBe(null);
    expect(pulseOf(pr({ requestedReviewers: ["bob"] }), opts).reason).toBe(
      null,
    );
  });
});

describe("pulseCounts", () => {
  it("puts every row in exactly one bucket", () => {
    const rows = [
      pr({ prId: "a", requestedReviewers: ["me"] }),
      pr({ prId: "b", approvalCount: 1 }),
      pr({ prId: "c", isDraft: true }),
    ];
    expect(pulseCounts(rows, opts)).toEqual({
      "blocked-on-you": 1,
      rotting: 0,
      "blocked-on-them": 0,
      ready: 1,
      moving: 1,
    });
  });
});

describe("groupPullRequests", () => {
  it("returns one group of everything when flat", () => {
    const rows = [pr({ prId: "a" }), pr({ prId: "b" })];
    expect(groupPullRequests(rows, "none", opts)).toHaveLength(1);
  });

  it("puts YOU first when grouping by author", () => {
    const rows = [
      pr({ prId: "a", author: "zoe", updatedAt: "2026-08-27T11:59:00Z" }),
      pr({ prId: "b", author: "me", updatedAt: "2026-08-20T00:00:00Z" }),
    ];
    expect(groupPullRequests(rows, "author", opts).map((g) => g.key)).toEqual([
      "me",
      "zoe",
    ]);
  });

  it("keeps pulse groups in worst-first order and drops empty ones", () => {
    const rows = [
      pr({ prId: "a", approvalCount: 1 }),
      pr({ prId: "b", requestedReviewers: ["me"] }),
    ];
    expect(groupPullRequests(rows, "pulse", opts).map((g) => g.key)).toEqual([
      "blocked-on-you",
      "ready",
    ]);
  });

  it("orders repos by volume", () => {
    const rows = [
      pr({ prId: "a", repo: "web" }),
      pr({ prId: "b", repo: "api" }),
      pr({ prId: "c", repo: "api" }),
    ];
    expect(groupPullRequests(rows, "repo", opts).map((g) => g.key)).toEqual([
      "acme/api",
      "acme/web",
    ]);
  });

  it("sorts rows inside a group newest first", () => {
    const rows = [
      pr({ prId: "old", updatedAt: "2026-08-01T00:00:00Z" }),
      pr({ prId: "new", updatedAt: "2026-08-27T00:00:00Z" }),
    ];
    expect(
      groupPullRequests(rows, "none", opts)[0].rows.map((p) => p.prId),
    ).toEqual(["new", "old"]);
  });
});

describe("dedupePrs", () => {
  const a = pr({ prId: "acme/web#1", updatedAt: "2026-08-20T00:00:00Z" });
  const b = pr({ prId: "acme/web#2", updatedAt: "2026-08-27T00:00:00Z" });
  const c = pr({ prId: "acme/web#3", updatedAt: "2026-08-24T00:00:00Z" });

  it("keeps arrival order, so a query's own sort survives", () => {
    // The queue hands GitHub's page straight through: re-sorting here would
    // arrange the first 50 of one ordering by another.
    expect(dedupePrs([a, b, c]).map((p) => p.prId)).toEqual([
      "acme/web#1",
      "acme/web#2",
      "acme/web#3",
    ]);
  });

  it("keeps the first copy of a PR two shards both matched", () => {
    const later = pr({ prId: "acme/web#1", title: "From the second shard" });
    const rows = dedupePrs([a, b, later]);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe(a.title);
  });
});
