import { describe, expect, it } from "vitest";
import type { AgentRun, Finding } from "../../../shared/agent-types";
import type { ChatActionJson } from "../../../shared/chat-schema";
import { chatKeyOf } from "../../../shared/chat-types";
import type { DiffLineIndex } from "../../../shared/gh/patch";
import type { PendingReview } from "../../../shared/review-types";
import { sanitizeChatActions, type SanitizeContext } from "./actions";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  runId: "r1",
  prId: "o/r#1",
  headSha: "abc",
  path: "src/a.ts",
  side: "RIGHT",
  endLine: 10,
  severity: "nit",
  category: "style",
  title: "t",
  body: "b",
  confidence: 0.5,
  evidence: [{ path: "src/a.ts", lines: "10", why: "w" }],
  state: "proposed",
  ...over,
});

const run = (findings: Finding[]): AgentRun => ({
  id: "r1",
  prId: "o/r#1",
  headSha: "abc",
  status: "ready",
  findings,
  tokensUsed: 0,
  costUsd: 0,
});

const review = (): PendingReview => ({
  prId: "o/r#1",
  headSha: "abc",
  comments: [
    {
      localId: "c1",
      path: "src/a.ts",
      line: 10,
      side: "RIGHT",
      body: "old body",
      findingId: "f2",
    },
  ],
  viewedFiles: [],
  updatedAt: "",
});

const index = (): Map<string, DiffLineIndex> =>
  new Map([["src/a.ts", { left: new Set([5]), right: new Set([10, 11]) }]]);

function ctx(over: Partial<SanitizeContext> = {}): SanitizeContext {
  let n = 0;
  return {
    run: run([finding()]),
    review: review(),
    lineIndexByPath: index(),
    threads: [],
    newId: () => `a${++n}`,
    ...over,
  };
}

const newFindingJson = (over: Record<string, unknown> = {}) => ({
  path: "src/a.ts",
  side: "RIGHT" as const,
  endLine: 11,
  severity: "risk" as const,
  category: "correctness" as const,
  title: "off by one",
  body: "the loop misses the last element",
  confidence: 0.8,
  evidence: [{ path: "src/a.ts", lines: "11", why: "the bound" }],
  ...over,
});

describe("chatKeyOf", () => {
  it("keys a conversation by scope, so a new sha is a new thread", () => {
    expect(chatKeyOf("o/r#1", "abc")).toBe("o/r#1@abc");
    expect(chatKeyOf("o/r#1", "def")).not.toBe(chatKeyOf("o/r#1", "abc"));
    expect(chatKeyOf("o/r#1", "abc", "f1")).toBe("o/r#1@abc#f1");
  });
});

describe("sanitizeChatActions", () => {
  it("keeps a revision of a finding still in triage", () => {
    const proposed: ChatActionJson[] = [
      { kind: "revise-finding", findingId: "f1", body: "softer", why: "asked" },
    ];
    const { actions, discarded } = sanitizeChatActions(proposed, ctx());
    expect(discarded).toBe(0);
    expect(actions).toEqual([
      {
        id: "a1",
        state: "proposed",
        why: "asked",
        kind: "revise-finding",
        findingId: "f1",
        title: undefined,
        body: "softer",
        severity: undefined,
        suggestion: undefined,
      },
    ]);
  });

  it("drops a revision that changes nothing", () => {
    const { actions, discarded } = sanitizeChatActions(
      [{ kind: "revise-finding", findingId: "f1", why: "asked" }],
      ctx(),
    );
    expect(actions).toEqual([]);
    expect(discarded).toBe(1);
  });

  it("drops a revision of a STAGED finding — the draft owns that text", () => {
    const { actions, discarded } = sanitizeChatActions(
      [{ kind: "revise-finding", findingId: "f1", body: "x", why: "w" }],
      ctx({ run: run([finding({ state: "staged" })]) }),
    );
    expect(actions).toEqual([]);
    expect(discarded).toBe(1);
  });

  it("drops actions naming a finding that does not exist", () => {
    const { discarded } = sanitizeChatActions(
      [{ kind: "dismiss-finding", findingId: "nope", why: "w" }],
      ctx(),
    );
    expect(discarded).toBe(1);
  });

  it("refuses to dismiss a posted finding (illegal transition)", () => {
    const { discarded } = sanitizeChatActions(
      [{ kind: "dismiss-finding", findingId: "f1", why: "w" }],
      ctx({ run: run([finding({ state: "posted" })]) }),
    );
    expect(discarded).toBe(1);
  });

  it("keeps a new finding that anchors to a real diff line", () => {
    const { actions, discarded } = sanitizeChatActions(
      [{ kind: "new-finding", finding: newFindingJson(), why: "w" }],
      ctx(),
    );
    expect(discarded).toBe(0);
    expect(actions[0]).toMatchObject({ kind: "new-finding" });
  });

  it("drops a new finding anchored to a line outside the diff", () => {
    const { actions, discarded } = sanitizeChatActions(
      [
        {
          kind: "new-finding",
          finding: newFindingJson({ endLine: 999 }),
          why: "w",
        },
      ],
      ctx(),
    );
    expect(actions).toEqual([]);
    expect(discarded).toBe(1);
  });

  it("drops a new finding where a human already commented", () => {
    const { discarded } = sanitizeChatActions(
      [{ kind: "new-finding", finding: newFindingJson(), why: "w" }],
      ctx({
        threads: [
          {
            id: "t1",
            path: "src/a.ts",
            line: 11,
            side: "RIGHT",
            isResolved: false,
            isOutdated: false,
            comments: [],
          },
        ],
      }),
    );
    expect(discarded).toBe(1);
  });

  it("drops a new finding when there is no ready run to hold it", () => {
    const { discarded } = sanitizeChatActions(
      [{ kind: "new-finding", finding: newFindingJson(), why: "w" }],
      ctx({ run: null }),
    );
    expect(discarded).toBe(1);
  });

  it("keeps a comment revision only for a localId in the draft", () => {
    const { actions, discarded } = sanitizeChatActions(
      [
        { kind: "revise-comment", localId: "c1", body: "new", why: "w" },
        { kind: "revise-comment", localId: "gone", body: "new", why: "w" },
      ],
      ctx(),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "revise-comment", localId: "c1" });
    expect(discarded).toBe(1);
  });
});
