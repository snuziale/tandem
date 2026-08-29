import { describe, expect, it } from "vitest";
import type { AgentRun, Finding } from "../../shared/agent-types";
import type { FileChange, PendingReview } from "../../shared/review-types";
import { chatOpeners } from "./chatOpeners";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    runId: "r1",
    prId: "o/r#1",
    headSha: "sha",
    path: "src/a.ts",
    side: "RIGHT",
    endLine: 12,
    severity: "risk",
    category: "correctness",
    title: "Clamp walks past the hunk",
    body: "body",
    confidence: 0.8,
    evidence: [],
    state: "proposed",
    ...over,
  };
}

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "r1",
    prId: "o/r#1",
    headSha: "sha",
    status: "ready",
    findings: [],
    ...over,
  } as AgentRun;
}

function file(path: string, add: number, del: number): FileChange {
  return {
    path,
    status: "modified",
    additions: add,
    deletions: del,
    // `unreadFile` runs `analyzableFiles`, which requires a real patch — a
    // file with none is one the agent cannot read either.
    patch: "@@ -1 +1 @@\n-a\n+b\n",
  } as FileChange;
}

function review(over: Partial<PendingReview> = {}): PendingReview {
  return {
    prId: "o/r#1",
    headSha: "sha",
    comments: [],
    viewedFiles: [],
    updatedAt: "",
    ...over,
  };
}

describe("chatOpeners — no run", () => {
  it("offers where-to-start questions instead of nothing", () => {
    const out = chatOpeners({
      run: undefined,
      review: null,
      files: [file("src/a.ts", 10, 2)],
      finding: null,
    });
    expect(out.map((o) => o.id)).toContain("first");
    expect(out.map((o) => o.id)).toContain("risk");
  });
});

describe("chatOpeners — PR scope", () => {
  it("names the blocker in the chip", () => {
    const out = chatOpeners({
      run: run({ findings: [finding({ severity: "blocker" })] }),
      review: null,
      files: [file("src/a.ts", 10, 2)],
      finding: null,
    });
    const blocker = out.find((o) => o.id === "blocker");
    expect(blocker?.label).toContain("Clamp walks past the hunk");
    expect(blocker?.question).toContain("src/a.ts:12");
  });

  it("asks about the score only when it is below green", () => {
    const low = chatOpeners({
      run: run({ score: 61, findings: [finding()] }),
      review: null,
      files: [],
      finding: null,
    });
    expect(low.find((o) => o.id === "score")?.label).toContain("61");

    const green = chatOpeners({
      run: run({ score: 95, findings: [finding()] }),
      review: null,
      files: [],
      finding: null,
    });
    expect(green.find((o) => o.id === "score")).toBeUndefined();
  });

  it("asks what was NOT flagged only when nothing was", () => {
    const empty = chatOpeners({
      run: run({ findings: [] }),
      review: null,
      files: [],
      finding: null,
    });
    expect(empty.map((o) => o.id)).toContain("notflagged");

    const some = chatOpeners({
      run: run({ findings: [finding()] }),
      review: null,
      files: [],
      finding: null,
    });
    expect(some.map((o) => o.id)).not.toContain("notflagged");
  });

  it("offers a read-back once something is staged, counted correctly", () => {
    const out = chatOpeners({
      run: run({ findings: [finding()] }),
      review: review({
        comments: [
          {
            localId: "c1",
            path: "src/a.ts",
            line: 1,
            side: "RIGHT",
            body: "x",
          },
        ],
      }),
      files: [],
      finding: null,
    });
    expect(out.find((o) => o.id === "draft")?.label).toBe(
      "Read back my 1 staged comment",
    );
  });

  it("points at the biggest unviewed, unflagged, non-generated file", () => {
    const out = chatOpeners({
      run: run({ findings: [finding({ path: "src/big.ts" })] }),
      review: review({ viewedFiles: ["src/seen.ts"] }),
      files: [
        file("src/big.ts", 500, 0), // flagged
        file("src/seen.ts", 400, 0), // viewed
        file("src/quiet.ts", 300, 0), // the answer
        file("src/tiny.ts", 2, 0),
      ],
      finding: null,
    });
    expect(out.find((o) => o.id === "unread")?.question).toContain(
      "src/quiet.ts",
    );
  });

  it("skips files the agent cannot read when picking the unread one", () => {
    const generated = { ...file("src/gen.ts", 900, 0), isGenerated: true };
    const binary = { ...file("logo.png", 800, 0), isBinary: true };
    const out = chatOpeners({
      run: run(),
      review: null,
      files: [generated, binary, file("src/real.ts", 10, 0)],
      finding: null,
    });
    expect(out.find((o) => o.id === "unread")?.question).toContain(
      "src/real.ts",
    );
  });

  it("never offers more than four", () => {
    const out = chatOpeners({
      run: run({ score: 40, findings: [finding({ severity: "blocker" })] }),
      review: review({
        comments: [
          { localId: "c1", path: "a", line: 1, side: "RIGHT", body: "x" },
        ],
      }),
      files: [file("src/a.ts", 10, 2), file("src/b.ts", 90, 2)],
      finding: null,
    });
    expect(out.length).toBeLessThanOrEqual(4);
  });
});

describe("chatOpeners — finding scope", () => {
  it("asks about the finding, not the PR", () => {
    const out = chatOpeners({
      run: run({ findings: [finding({ severity: "blocker" })] }),
      review: null,
      files: [],
      finding: finding({ severity: "blocker" }),
    });
    expect(out[0].label).toBe("Why is this a blocker?");
    expect(out.map((o) => o.id)).not.toContain("score");
  });

  it("offers to write the fix only when there is no suggestion yet", () => {
    const without = chatOpeners({
      run: run(),
      review: null,
      files: [],
      finding: finding(),
    });
    expect(without.map((o) => o.id)).toContain("suggest");

    const with_ = chatOpeners({
      run: run(),
      review: null,
      files: [],
      finding: finding({ suggestion: "const a = 1;" }),
    });
    expect(with_.map((o) => o.id)).not.toContain("suggest");
  });
});
