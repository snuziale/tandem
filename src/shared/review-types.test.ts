import { describe, expect, it } from "vitest";
import {
  hasUnseenChanges,
  isAgentAuthored,
  seenSignalOf,
  type PendingComment,
  type PullRequest,
  type SeenRecord,
} from "./review-types";

function comment(over: Partial<PendingComment> = {}): PendingComment {
  return {
    localId: "c1",
    path: "src/a.ts",
    line: 12,
    side: "RIGHT",
    body: "b",
    ...over,
  };
}

describe("isAgentAuthored", () => {
  it("is true for a comment accepted from a finding", () => {
    expect(isAgentAuthored(comment({ findingId: "f1" }))).toBe(true);
  });

  it("is true for one the agent drafted in chat, which has no finding", () => {
    // The case that made the inline card label agent text "your comment".
    expect(isAgentAuthored(comment({ agentDrafted: true }))).toBe(true);
  });

  it("is false for one the reviewer typed", () => {
    expect(isAgentAuthored(comment())).toBe(false);
  });
});

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    prId: "o/r#1",
    owner: "o",
    repo: "r",
    number: 1,
    title: "t",
    bodyMarkdown: "",
    author: "alice",
    headRef: "feat",
    baseRef: "main",
    headSha: "sha1",
    isDraft: false,
    state: "OPEN",
    commitCount: 1,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    reviewDecision: null,
    viewerReviewState: null,
    checkRollup: "NONE",
    checkRuns: [],
    threadCount: 0,
    unresolvedThreadCount: 0,
    approvalCount: 0,
    changesRequestedCount: 0,
    commentCount: 0,
    autoMergeBy: null,
    requestedReviewers: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    url: "https://example.test/pr/1",
    ...over,
  };
}

function seenOf(over: Partial<SeenRecord> = {}): Record<string, SeenRecord> {
  return {
    "o/r#1": {
      prId: "o/r#1",
      seenAt: "2026-08-01T00:00:00Z",
      ...seenSignalOf(pr()),
      ...over,
    },
  };
}

describe("hasUnseenChanges", () => {
  it("is quiet while nothing has been loaded", () => {
    expect(hasUnseenChanges(undefined, pr())).toBe(false);
  });

  it("marks a PR that was never opened", () => {
    expect(hasUnseenChanges({}, pr())).toBe(true);
  });

  it("marks a new head sha", () => {
    expect(hasUnseenChanges(seenOf(), pr({ headSha: "sha2" }))).toBe(true);
  });

  it("marks a new comment and a new review thread", () => {
    expect(hasUnseenChanges(seenOf(), pr({ commentCount: 1 }))).toBe(true);
    expect(hasUnseenChanges(seenOf(), pr({ threadCount: 1 }))).toBe(true);
  });

  it("ignores metadata churn that only moved updatedAt", () => {
    // The whole point of the widening: a label, an assignee or a title edit
    // bumps updatedAt and leaves nothing new to read.
    expect(
      hasUnseenChanges(seenOf(), pr({ updatedAt: "2026-08-09T00:00:00Z" })),
    ).toBe(false);
  });

  it("ignores a DELETED comment — counts only ever grow", () => {
    const seen = seenOf({ commentCount: 3, threadCount: 2 });
    expect(
      hasUnseenChanges(seen, pr({ commentCount: 2, threadCount: 2 })),
    ).toBe(false);
  });

  it("falls back to updatedAt for a record written before the widening", () => {
    const legacy: Record<string, SeenRecord> = {
      "o/r#1": {
        prId: "o/r#1",
        updatedAt: "2026-08-01T00:00:00Z",
        seenAt: "2026-08-01T00:00:00Z",
      },
    };
    expect(hasUnseenChanges(legacy, pr())).toBe(false);
    expect(
      hasUnseenChanges(legacy, pr({ updatedAt: "2026-08-09T00:00:00Z" })),
    ).toBe(true);
  });

  it("does not read an absent sha as a moved one", () => {
    // A response that carried no commit node normalizes to "" — absent, not
    // different.
    expect(hasUnseenChanges(seenOf(), pr({ headSha: "" }))).toBe(false);
  });
});
