import { describe, expect, it } from "vitest";
import { canTransitionRun, type AgentRunStatus } from "../../shared/agent-types";
import { INTERRUPTED_AFTER_MS, isInterrupted } from "./runsIndex";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const run = (status: AgentRunStatus, startedAt?: string) => ({
  status,
  startedAt,
});

describe("isInterrupted", () => {
  it("claims an active run older than the window", () => {
    for (const status of ["queued", "fetching", "analyzing"] as const) {
      expect(
        isInterrupted(run(status, ago(INTERRUPTED_AFTER_MS + 1000)), NOW),
      ).toBe(true);
    }
  });

  it("leaves a young active run alone — another server may own it", () => {
    expect(isInterrupted(run("analyzing", ago(60_000)), NOW)).toBe(false);
    expect(
      isInterrupted(run("analyzing", ago(INTERRUPTED_AFTER_MS - 1000)), NOW),
    ).toBe(false);
  });

  it("never touches a settled run, however old", () => {
    for (const status of ["ready", "failed", "skipped", "stale"] as const) {
      expect(isInterrupted(run(status, ago(10 * 24 * 3600_000)), NOW)).toBe(
        false,
      );
    }
  });

  it("treats a missing or unparseable startedAt as interrupted", () => {
    expect(isInterrupted(run("analyzing"), NOW)).toBe(true);
    expect(isInterrupted(run("analyzing", "not a date"), NOW)).toBe(true);
  });

  it("every claimable status can legally reach failed", () => {
    for (const status of ["queued", "fetching", "analyzing"] as const) {
      expect(canTransitionRun(status, "failed")).toBe(true);
    }
  });
});
