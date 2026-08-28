import { describe, expect, it } from "vitest";
import {
  INTERRUPTED_AFTER_MS,
  isActiveRun,
  type AgentRun,
  type LiveWork,
  type RunStep,
} from "./agent-types";
import { inFlightWork, tallyToday, workFromRun } from "./agent-activity";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function run(patch: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    prId: "acme/widgets#1",
    headSha: "abc123",
    status: "analyzing",
    findings: [],
    tokensUsed: 1_000,
    costUsd: 0,
    startedAt: ago(60_000),
    ...patch,
  };
}

function step(patch: Partial<RunStep> = {}): RunStep {
  return {
    id: "analyze:0",
    pass: 2,
    label: "analyzing 1/3",
    status: "done",
    startedAt: ago(59_000),
    ...patch,
  };
}

function work(patch: Partial<LiveWork> = {}): LiveWork {
  return {
    id: "live-1",
    kind: "run",
    prId: "acme/widgets#9",
    label: "analyzing 2/3",
    startedAt: ago(30_000),
    tokensUsed: 0,
    costUsd: 0,
    ...patch,
  };
}

describe("isActiveRun", () => {
  it("covers every pre-outcome status", () => {
    expect(isActiveRun(run({ status: "queued" }))).toBe(true);
    expect(isActiveRun(run({ status: "fetching" }))).toBe(true);
    expect(isActiveRun(run({ status: "analyzing" }))).toBe(true);
  });

  it("excludes finished and stale runs", () => {
    for (const status of ["ready", "failed", "skipped", "stale"] as const)
      expect(isActiveRun(run({ status }))).toBe(false);
  });
});

describe("workFromRun", () => {
  it("describes a run from its running step", () => {
    const w = workFromRun(
      run({
        steps: [
          step(),
          step({
            id: "analyze:1",
            label: "analyzing 2/3",
            status: "running",
            paths: ["a/b.ts"],
          }),
        ],
      }),
    );
    expect(w.label).toBe("analyzing 2/3");
    expect(w.pass).toBe(2);
    expect(w.paths).toEqual(["a/b.ts"]);
  });

  it("falls back to the last step when nothing is running", () => {
    // The process died mid-run: the last step is the furthest it got.
    expect(workFromRun(run({ steps: [step()] })).label).toBe("analyzing 1/3");
  });

  it("falls back to the status when there are no steps at all", () => {
    expect(workFromRun(run({ status: "queued" })).label).toBe(
      "waiting for a slot",
    );
    expect(workFromRun(run({ status: "fetching" })).label).toBe(
      "reading changed files",
    );
  });
});

describe("inFlightWork", () => {
  it("adds an active run the live registry lost", () => {
    const merged = inFlightWork(
      [],
      [run(), run({ id: "r2", status: "ready" })],
      NOW,
    );
    expect(merged.map((w) => w.id)).toEqual(["run-1"]);
  });

  it("never duplicates a run the registry already knows", () => {
    const merged = inFlightWork([work({ id: "run-1" })], [run()], NOW);
    expect(merged).toHaveLength(1);
    // The registry's entry wins — a persisted step lags its own frame.
    expect(merged[0].label).toBe("analyzing 2/3");
  });

  it("orders newest first across both sources", () => {
    const merged = inFlightWork(
      [work({ id: "live-1", startedAt: ago(300_000) })],
      [run({ id: "run-1", startedAt: ago(60_000) })],
      NOW,
    );
    expect(merged.map((w) => w.id)).toEqual(["run-1", "live-1"]);
  });

  it("excludes an INTERRUPTED run — the startup sweep will fail it", () => {
    const dead = run({ startedAt: ago(INTERRUPTED_AFTER_MS + 60_000) });
    expect(inFlightWork([], [dead], NOW)).toEqual([]);
    // Inside the window it is a sibling server's live run, not a corpse.
    const young = run({ startedAt: ago(INTERRUPTED_AFTER_MS - 60_000) });
    expect(inFlightWork([], [young], NOW).map((w) => w.id)).toEqual(["run-1"]);
  });

  it("keeps chat turns, which have no run record", () => {
    const merged = inFlightWork(
      [work({ id: "chat-1", kind: "chat" })],
      [],
      NOW,
    );
    expect(merged.map((w) => w.kind)).toEqual(["chat"]);
  });
});

describe("tallyToday", () => {
  it("counts today's runs and failures, and ALL open findings", () => {
    const finding = (state: "proposed" | "staged") =>
      ({ state }) as AgentRun["findings"][number];
    const tally = tallyToday(
      [
        run({
          status: "ready",
          finishedAt: ago(60_000),
          findings: [finding("proposed"), finding("staged")],
        }),
        run({ status: "failed", finishedAt: ago(120_000) }),
        // Yesterday: its findings still count as backlog, the run does not.
        run({
          status: "ready",
          finishedAt: new Date(NOW - 40 * 3600_000).toISOString(),
          findings: [finding("proposed")],
        }),
      ],
      NOW,
    );
    expect(tally).toEqual({ runs: 2, failed: 1, openFindings: 2 });
  });
});
