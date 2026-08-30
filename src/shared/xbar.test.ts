import { describe, expect, it } from "vitest";
import { renderPulseMenu, xbarEscape, xbarLine } from "./xbar";
import type { PullRequest } from "./review-types";

const NOW = Date.parse("2026-08-27T12:00:00Z");

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

describe("xbarEscape", () => {
  // `|` is the parameter separator, so it can never survive inside the text.
  it("replaces pipes and flattens newlines", () => {
    expect(xbarEscape("a | b\n  c")).toBe("a - b c");
  });
});

describe("xbarLine", () => {
  it("renders text alone when there are no params", () => {
    expect(xbarLine("hello")).toBe("hello");
  });
  it("appends params after a pipe and nests by depth", () => {
    expect(xbarLine("hi", { href: "u", size: 12 }, 1)).toBe(
      "--hi | href=u size=12",
    );
  });
});

describe("renderPulseMenu", () => {
  const opts = { now: NOW, viewerLogin: "me", rottingDays: 7 };

  it("leads the menu bar with what needs YOU", () => {
    const text = renderPulseMenu(
      [pr({ requestedReviewers: ["me"] }), pr({ prId: "b", approvalCount: 1 })],
      opts,
    );
    expect(text.split("\n")[0]).toBe("👀 1 · 2 🧑‍💻");
  });

  it("says so when nothing is open", () => {
    expect(renderPulseMenu([], opts)).toContain("Nothing open");
  });

  it("groups under headings and links each row", () => {
    const text = renderPulseMenu([pr({ requestedReviewers: ["me"] })], opts);
    expect(text).toContain("BLOCKED ON YOU · 1");
    expect(text).toContain("href=https://github.com/acme/web/pull/1");
  });

  // Drafts and freshly-pushed work are what nobody is waiting on — the
  // original script folded them away too.
  it("nests the `moving` group into a submenu", () => {
    const text = renderPulseMenu([pr({ isDraft: true })], opts);
    const row = text.split("\n").find((l) => l.includes("Something"));
    expect(row?.startsWith("--")).toBe(true);
  });

  it("carries the signal glyphs", () => {
    const text = renderPulseMenu(
      [pr({ approvalCount: 2, commentCount: 3, autoMergeBy: "bob" })],
      opts,
    );
    expect(text).toContain("2 ✅");
    expect(text).toContain("3 💬");
    expect(text).toContain("🦾");
  });

  it("always ends with a refresh action", () => {
    expect(
      renderPulseMenu([pr()], opts).trimEnd().endsWith("refresh=true"),
    ).toBe(true);
  });
});
