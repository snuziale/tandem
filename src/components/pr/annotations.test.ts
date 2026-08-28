import { describe, expect, it } from "vitest";
import type { SelectedLineRange } from "@pierre/diffs";
import { diffLineIndex } from "../../shared/gh/patch";
import { commentAnchorOf, spanOf, startLineOf } from "./annotations";

describe("spanOf / startLineOf", () => {
  it("treats an absent startLine as the anchor's own line", () => {
    expect(spanOf(undefined, 42)).toEqual({ start: 42, end: 42 });
  });

  it("clamps a startLine that sits below the anchor", () => {
    expect(spanOf(50, 42)).toEqual({ start: 42, end: 42 });
    expect(spanOf(40, 42)).toEqual({ start: 40, end: 42 });
  });

  it("collapses a one-line range back to no startLine", () => {
    expect(startLineOf(42, 42)).toBeUndefined();
    expect(startLineOf(40, 42)).toBe(40);
  });
});

describe("commentAnchorOf", () => {
  // Right side 10-13, then a gap, then 50-51.
  const index = diffLineIndex(
    [
      "@@ -10,3 +10,4 @@",
      " ctx",
      "-gone",
      "+new1",
      "+new2",
      " ctx2",
      "@@ -50,2 +50,2 @@",
      " x",
      "-y",
      "+z",
    ].join("\n"),
  );
  const range = (r: Partial<SelectedLineRange>): SelectedLineRange =>
    ({ start: 0, end: 0, side: "additions", ...r }) as SelectedLineRange;

  it("keeps a range inside one hunk, anchored at the end", () => {
    expect(commentAnchorOf(range({ start: 11, end: 13 }), index)).toEqual({
      line: 13,
      startLine: 11,
      side: "RIGHT",
    });
  });

  it("normalizes an upward drag — the anchor is the larger line", () => {
    expect(commentAnchorOf(range({ start: 13, end: 11 }), index)).toEqual({
      line: 13,
      startLine: 11,
      side: "RIGHT",
    });
  });

  it("drops startLine for a single line", () => {
    expect(commentAnchorOf(range({ start: 12, end: 12 }), index)).toEqual({
      line: 12,
      startLine: undefined,
      side: "RIGHT",
    });
  });

  it("stops at the hunk edge rather than spanning the gap", () => {
    expect(commentAnchorOf(range({ start: 20, end: 51 }), index)).toEqual({
      line: 51,
      startLine: 50,
      side: "RIGHT",
    });
  });

  it("refuses a drag whose anchor is outside the patch", () => {
    expect(commentAnchorOf(range({ start: 30, end: 40 }), index)).toBeNull();
  });

  it("defaults a missing side to the new side", () => {
    expect(
      commentAnchorOf(range({ start: 12, end: 13, side: undefined }), index),
    ).toEqual({ line: 13, startLine: 12, side: "RIGHT" });
  });

  it("a split-view drag that crossed sides is not one comment", () => {
    // Started on the old side at 10, ended on the new side at 13: GitHub has
    // no anchor for that, so it degrades to the line the pointer ended on.
    expect(
      commentAnchorOf(
        range({ start: 10, end: 13, side: "deletions", endSide: "additions" }),
        index,
      ),
    ).toEqual({ line: 13, startLine: undefined, side: "RIGHT" });
  });

  it("reads the LEFT side against old-file numbering", () => {
    expect(
      commentAnchorOf(range({ start: 10, end: 12, side: "deletions" }), index),
    ).toEqual({ line: 12, startLine: 10, side: "LEFT" });
  });
});
