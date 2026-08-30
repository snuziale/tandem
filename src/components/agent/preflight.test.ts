import { describe, expect, it } from "vitest";
import type { AgentRun, Finding } from "../../shared/agent-types";
import type { FileChange, PullRequest } from "../../shared/review-types";
import {
  DEFAULT_SETTINGS,
  type TandemSettings,
} from "../../shared/settings-types";
import { preflightOf, priorReviewFor, queueRunGate } from "./preflight";

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    owner: "o",
    repo: "r",
    number: 1,
    isDraft: false,
    changedFiles: 2,
    ...over,
  } as PullRequest;
}

function file(
  path: string,
  add = 10,
  over: Partial<FileChange> = {},
): FileChange {
  return {
    path,
    status: "modified",
    additions: add,
    deletions: 0,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    ...over,
  } as FileChange;
}

function settings(over: Partial<TandemSettings> = {}): TandemSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f",
    runId: "r1",
    prId: "o/r#1",
    headSha: "old",
    path: "src/a.ts",
    side: "RIGHT",
    endLine: 1,
    severity: "risk",
    category: "correctness",
    title: "t",
    body: "b",
    confidence: 0.7,
    evidence: [],
    state: "proposed",
    ...over,
  };
}

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "r1",
    prId: "o/r#1",
    headSha: "old",
    status: "stale",
    findings: [],
    tokensUsed: 0,
    costUsd: 0,
    finishedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("preflightOf", () => {
  const base = {
    pr: pr(),
    files: [file("src/a.ts"), file("src/b.ts")],
    settings: settings(),
    spentTodayUsd: 0,
  };

  it("clears a normal PR and reports the shape of the run", () => {
    const out = preflightOf(base);
    expect(out.decision).toEqual({ skip: false });
    expect(out.passes).toBe(1);
    expect(out.analyzed).toBe(2);
    expect(out.diffLines).toBe(20);
  });

  it("predicts the draft skip rather than letting the reviewer find out", () => {
    const out = preflightOf({ ...base, pr: pr({ isDraft: true }) });
    expect(out.decision).toEqual({ skip: true, reason: "draft" });
  });

  it("predicts the file cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => file(`src/f${i}.ts`, 1));
    const out = preflightOf({
      ...base,
      pr: pr({ changedFiles: 50 }),
      files: many,
    });
    expect(out.decision).toEqual({ skip: true, reason: "too-many-files" });
  });

  it("counts files the way the SERVER does — pr.changedFiles, not the list", () => {
    // The files endpoint caps its list (FILES_API_WINDOW), so on a big PR the
    // two disagree. Reading the list would have the card offer a run the
    // pipeline then refuses with `too-many-files`, which is the exact promise
    // this module exists to keep.
    const truncated = Array.from({ length: 10 }, (_, i) =>
      file(`src/f${i}.ts`, 1),
    );
    const out = preflightOf({
      ...base,
      pr: pr({ changedFiles: 400 }),
      files: truncated,
    });
    expect(out.decision).toEqual({ skip: true, reason: "too-many-files" });
  });

  it("predicts the budget stop with the day's real spend", () => {
    const out = preflightOf({
      ...base,
      settings: settings({ dailyCostUsd: 5 }),
      spentTodayUsd: 5,
    });
    expect(out.decision).toEqual({ skip: true, reason: "budget" });
  });

  it("counts a lockfile-only PR as generated, and reads nothing", () => {
    const out = preflightOf({
      ...base,
      pr: pr({ changedFiles: 1 }),
      files: [file("pnpm-lock.yaml", 900, { isGenerated: true })],
    });
    expect(out.decision).toEqual({ skip: true, reason: "generated-only" });
    expect(out.analyzed).toBe(0);
    expect(out.passes).toBe(0);
  });

  it("reads the per-repo toggle, so a disabled repo says so", () => {
    const out = preflightOf({
      ...base,
      settings: settings({ repos: { "o/r": { agentEnabled: false } } }),
    });
    expect(out.decision).toEqual({ skip: true, reason: "agent-disabled" });
  });

  it("counts passes off the files it would actually read", () => {
    const out = preflightOf({
      ...base,
      pr: pr({ changedFiles: 10 }),
      files: [
        ...Array.from({ length: 9 }, (_, i) => file(`src/f${i}.ts`, 1)),
        file("pnpm-lock.yaml", 900, { isGenerated: true }),
      ],
    });
    expect(out.analyzed).toBe(9);
    expect(out.passes).toBe(2);
  });
});

describe("priorReviewFor", () => {
  const files = [file("src/a.ts"), file("src/b.ts")];
  const ask = (runs: AgentRun[]) =>
    priorReviewFor({ runs, prId: "o/r#1", headSha: "new", files });

  it("finds a finished run on an earlier commit", () => {
    const out = ask([run({ findings: [finding()] })]);
    expect(out?.run.headSha).toBe("old");
    expect(out).toMatchObject({ live: 1, total: 1 });
  });

  it("returns the findings behind the counts, so the card need not refilter", () => {
    const out = ask([
      run({
        findings: [
          finding({ id: "1" }),
          finding({ id: "2", state: "dismissed" }),
        ],
      }),
    ]);
    expect(out?.findings.map((f) => f.id)).toEqual(["1"]);
    expect(out?.total).toBe(out?.findings.length);
  });

  it("ignores the run for the CURRENT commit", () => {
    expect(ask([run({ headSha: "new", status: "ready" })])).toBeNull();
  });

  it("ignores other pull requests", () => {
    expect(ask([run({ prId: "o/r#2" })])).toBeNull();
  });

  it("ignores runs with nothing to say", () => {
    expect(
      ask([run({ status: "failed" }), run({ status: "skipped" })]),
    ).toBeNull();
  });

  it("takes the most recently finished of several", () => {
    const out = ask([
      run({ id: "old", headSha: "s1", finishedAt: "2026-08-01T00:00:00Z" }),
      run({ id: "new", headSha: "s2", finishedAt: "2026-08-20T00:00:00Z" }),
    ]);
    expect(out?.run.id).toBe("new");
  });

  it("sorts an unfinished run last instead of throwing", () => {
    const out = ask([
      run({ id: "nofinish", headSha: "s1", finishedAt: undefined }),
      run({ id: "done", headSha: "s2", finishedAt: "2026-08-02T00:00:00Z" }),
    ]);
    expect(out?.run.id).toBe("done");
  });

  it("counts only findings this commit still touches as live", () => {
    const out = ask([
      run({
        findings: [
          finding({ id: "1", path: "src/a.ts" }),
          finding({ id: "2", path: "src/gone.ts" }),
        ],
      }),
    ]);
    expect(out).toMatchObject({ live: 1, total: 2 });
  });

  it("does not hand back business a human already settled", () => {
    const out = ask([
      run({
        findings: [
          finding({ id: "1", state: "dismissed" }),
          finding({ id: "2", state: "posted" }),
          finding({ id: "3", state: "proposed" }),
        ],
      }),
    ]);
    expect(out).toMatchObject({ live: 1, total: 1 });
  });
});

describe("queueRunGate", () => {
  const ask = (
    over: Partial<PullRequest>,
    set: Partial<TandemSettings> = {},
    spentTodayUsd = 0,
  ) => queueRunGate({ pr: pr(over), settings: settings(set), spentTodayUsd });

  it("offers the run when nothing the queue can see would stop it", () => {
    expect(ask({})).toBeNull();
  });

  it("names the gates a search response answers exactly", () => {
    expect(ask({ isDraft: true })).toBe("draft");
    expect(ask({ changedFiles: 999 }, { maxChangedFiles: 40 })).toBe(
      "too-many-files",
    );
    expect(ask({}, { dailyCostUsd: 5 }, 5)).toBe("budget");
    expect(ask({}, { agentEnabledByDefault: false })).toBe("agent-disabled");
  });

  it("reads the per-repo toggle, not just the default", () => {
    expect(
      ask(
        { owner: "o", repo: "r" },
        { repos: { "o/r": { agentEnabled: false } } },
      ),
    ).toBe("agent-disabled");
    expect(
      ask(
        { owner: "o", repo: "r" },
        {
          agentEnabledByDefault: false,
          repos: { "o/r": { agentEnabled: true } },
        },
      ),
    ).toBeNull();
  });

  it("honours skipDrafts rather than hard-coding drafts", () => {
    expect(ask({ isDraft: true }, { skipDrafts: false })).toBeNull();
  });

  // The two gates a queue row cannot evaluate — it has counts, never patches.
  // Staying silent means the pipeline can still record a Skip; claiming one
  // would disable a button on a guess, which is the direction that costs the
  // reviewer a review.
  it("never refuses a run on a gate it cannot evaluate", () => {
    expect(ask({ additions: 100_000, deletions: 100_000 })).toBeNull();
  });
});
