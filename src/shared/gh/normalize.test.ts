import { describe, expect, it } from "vitest";
import {
  checkRunOf,
  normalizeFile,
  normalizePr,
  normalizeThread,
  rollupOf,
} from "./normalize";
import type { GqlPrNode, GqlReviewThread, RestPullFile } from "./wire";

function prNode(overrides: Partial<GqlPrNode> = {}): GqlPrNode {
  return {
    __typename: "PullRequest",
    number: 234,
    title: "Refactor FlowFileEditor state",
    url: "https://github.com/uipath/flow-workbench/pull/234",
    author: { login: "mbayyaram" },
    repository: { name: "flow-workbench", owner: { login: "uipath" } },
    headRefName: "feat/flow-editor-state",
    baseRefName: "main",
    isDraft: false,
    additions: 218,
    deletions: 94,
    changedFiles: 6,
    reviewDecision: "REVIEW_REQUIRED",
    createdAt: "2026-08-19T08:00:00Z",
    updatedAt: "2026-08-21T10:00:00Z",
    state: "OPEN",
    reviewThreads: { totalCount: 1 },
    commits: {
      totalCount: 5,
      nodes: [
        {
          commit: {
            oid: "a3f9c21",
            statusCheckRollup: {
              state: "FAILURE",
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "build",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                  },
                  {
                    __typename: "CheckRun",
                    name: "e2e",
                    status: "COMPLETED",
                    conclusion: "FAILURE",
                  },
                  {
                    __typename: "CheckRun",
                    name: "lint",
                    status: "IN_PROGRESS",
                    conclusion: null,
                  },
                  {
                    __typename: "StatusContext",
                    context: "visual-diff",
                    state: "PENDING",
                  },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("rollupOf", () => {
  it("maps GitHub rollup states onto the app rollup", () => {
    expect(rollupOf("SUCCESS")).toBe("SUCCESS");
    expect(rollupOf("FAILURE")).toBe("FAILURE");
    expect(rollupOf("ERROR")).toBe("FAILURE");
    expect(rollupOf("PENDING")).toBe("PENDING");
    expect(rollupOf("EXPECTED")).toBe("PENDING");
    expect(rollupOf(null)).toBe("NONE");
    expect(rollupOf(undefined)).toBe("NONE");
  });
});

describe("checkRunOf", () => {
  it("treats non-success completions as failure", () => {
    expect(
      checkRunOf({
        __typename: "CheckRun",
        name: "x",
        status: "COMPLETED",
        conclusion: "TIMED_OUT",
      }).status,
    ).toBe("failure");
    expect(
      checkRunOf({
        __typename: "CheckRun",
        name: "x",
        status: "COMPLETED",
        conclusion: "CANCELLED",
      }).status,
    ).toBe("failure");
    expect(
      checkRunOf({
        __typename: "CheckRun",
        name: "x",
        status: "COMPLETED",
        conclusion: "NEUTRAL",
      }).status,
    ).toBe("neutral");
  });
  it("maps incomplete runs and pending status contexts to pending", () => {
    expect(
      checkRunOf({
        __typename: "CheckRun",
        name: "x",
        status: "QUEUED",
        conclusion: null,
      }).status,
    ).toBe("pending");
    expect(
      checkRunOf({
        __typename: "StatusContext",
        context: "ci",
        state: "EXPECTED",
      }).status,
    ).toBe("pending");
  });
});

describe("normalizePr", () => {
  it("normalizes a search node", () => {
    const pr = normalizePr(prNode());
    expect(pr).not.toBeNull();
    expect(pr!.prId).toBe("uipath/flow-workbench#234");
    expect(pr!.headSha).toBe("a3f9c21");
    expect(pr!.checkRollup).toBe("FAILURE");
    expect(pr!.checkRuns).toHaveLength(4);
    expect(pr!.checkRuns.map((c) => c.status)).toEqual([
      "success",
      "failure",
      "pending",
      "pending",
    ]);
    expect(pr!.bodyMarkdown).toBe("");
    expect(pr!.state).toBe("OPEN");
    expect(pr!.commitCount).toBe(5);
  });

  it("falls back to OPEN and the fetched commit count when GitHub omits them", () => {
    const node = prNode({ state: undefined });
    node.commits.totalCount = undefined;
    const pr = normalizePr(node)!;
    expect(pr.state).toBe("OPEN");
    expect(pr.commitCount).toBe(1);
  });

  it("carries a merged state through", () => {
    expect(normalizePr(prNode({ state: "MERGED" }))!.state).toBe("MERGED");
  });

  it("drops non-PR search hits and defaults a deleted author to ghost", () => {
    expect(normalizePr({ ...prNode(), __typename: "Issue" })).toBeNull();
    expect(normalizePr(null)).toBeNull();
    expect(normalizePr(prNode({ author: null }))!.author).toBe("ghost");
  });

  it("handles a PR with no checks", () => {
    const node = prNode();
    node.commits.nodes[0].commit.statusCheckRollup = null;
    const pr = normalizePr(node)!;
    expect(pr.checkRollup).toBe("NONE");
    expect(pr.checkRuns).toEqual([]);
  });

  it("counts unresolved threads only when nodes were fetched", () => {
    expect(normalizePr(prNode())!.unresolvedThreadCount).toBe(0);
    const withNodes = prNode({
      reviewThreads: {
        totalCount: 2,
        nodes: [thread({ isResolved: true }), thread({ isResolved: false })],
      },
    });
    expect(normalizePr(withNodes)!.unresolvedThreadCount).toBe(1);
  });
});

function thread(overrides: Partial<GqlReviewThread> = {}): GqlReviewThread {
  return {
    id: "T_1",
    path: "src/editor/FlowFileEditor.tsx",
    line: 23,
    startLine: null,
    diffSide: "RIGHT",
    isResolved: false,
    isOutdated: false,
    comments: {
      nodes: [
        {
          id: "C_1",
          author: { login: "sflorentino" },
          body: "Nice.",
          createdAt: "2026-08-21T09:00:00Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("normalizeThread", () => {
  it("maps thread and comments", () => {
    const t = normalizeThread(thread());
    expect(t.side).toBe("RIGHT");
    expect(t.comments[0].author).toBe("sflorentino");
    expect(t.startLine).toBeUndefined();
  });
});

describe("normalizeFile", () => {
  const base: RestPullFile = {
    filename: "src/a.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: "@@ -1 +1 @@",
  };

  it("flags binaries (no patch, zero line changes)", () => {
    expect(
      normalizeFile({
        ...base,
        filename: "logo.png",
        patch: undefined,
        additions: 0,
        deletions: 0,
        changes: 0,
      }).isBinary,
    ).toBe(true);
    expect(normalizeFile(base).isBinary).toBe(false);
  });

  it("flags generated paths", () => {
    expect(
      normalizeFile({ ...base, filename: "pnpm-lock.yaml" }).isGenerated,
    ).toBe(true);
    expect(normalizeFile(base).isGenerated).toBe(false);
  });
});
