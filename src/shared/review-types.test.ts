import { describe, expect, it } from "vitest";
import { isAgentAuthored, type PendingComment } from "./review-types";

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
