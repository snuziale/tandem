import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings-types";
import { skipDecision, type SkipInput } from "./agent-decide";

const base: SkipInput = {
  isDraft: false,
  changedFiles: 6,
  diffLines: 300,
  allGenerated: false,
  agentEnabled: true,
  spentTodayUsd: 0,
};

describe("skipDecision", () => {
  it("runs an ordinary PR", () => {
    expect(skipDecision(base, DEFAULT_SETTINGS)).toEqual({ skip: false });
  });

  it("skips drafts when configured, runs them when not", () => {
    expect(skipDecision({ ...base, isDraft: true }, DEFAULT_SETTINGS)).toEqual({
      skip: true,
      reason: "draft",
    });
    expect(
      skipDecision(
        { ...base, isDraft: true },
        { ...DEFAULT_SETTINGS, skipDrafts: false },
      ),
    ).toEqual({ skip: false });
  });

  it("enforces the size caps", () => {
    expect(
      skipDecision({ ...base, changedFiles: 41 }, DEFAULT_SETTINGS),
    ).toEqual({ skip: true, reason: "too-many-files" });
    expect(
      skipDecision({ ...base, diffLines: 3001 }, DEFAULT_SETTINGS),
    ).toEqual({ skip: true, reason: "diff-too-large" });
    expect(
      skipDecision(
        { ...base, changedFiles: 40, diffLines: 3000 },
        DEFAULT_SETTINGS,
      ),
    ).toEqual({ skip: false });
  });

  it("skips generated-only and disabled repos", () => {
    expect(
      skipDecision({ ...base, allGenerated: true }, DEFAULT_SETTINGS),
    ).toEqual({ skip: true, reason: "generated-only" });
    expect(
      skipDecision({ ...base, agentEnabled: false }, DEFAULT_SETTINGS),
    ).toEqual({ skip: true, reason: "agent-disabled" });
  });

  it("stops at the daily budget ceiling", () => {
    expect(
      skipDecision({ ...base, spentTodayUsd: 20 }, DEFAULT_SETTINGS),
    ).toEqual({ skip: true, reason: "budget" });
    expect(
      skipDecision({ ...base, spentTodayUsd: 19.99 }, DEFAULT_SETTINGS),
    ).toEqual({ skip: false });
  });

  it("disabled beats every other reason (cheapest check first)", () => {
    expect(
      skipDecision(
        { ...base, agentEnabled: false, isDraft: true, spentTodayUsd: 99 },
        DEFAULT_SETTINGS,
      ),
    ).toEqual({
      skip: true,
      reason: "agent-disabled",
    });
  });
});
