import { describe, expect, it } from "vitest";
import type { FileChange } from "../review-types";
import {
  historyMarks,
  lineHistory,
  ownerOf,
  routeComment,
  toCombined,
  translate,
} from "./stack";

// base a b c d e → PR1 adds X after b → PR2 changes d→D → PR3 deletes a.
const file = (patch: string): FileChange[] => [
  {
    path: "f",
    status: "modified",
    additions: 0,
    deletions: 0,
    patch,
    isBinary: false,
    isGenerated: false,
  },
];
const layers = [
  file("@@ -1,5 +1,6 @@\n a\n b\n+X\n c\n d\n e"),
  file("@@ -3,4 +3,4 @@\n X\n c\n-d\n+D\n e"),
  file("@@ -1,2 +1,1 @@\n-a\n b"),
];
// Combined (base → top): b X c D e.

describe("translate", () => {
  it("maps across a gap, context and past the last hunk", () => {
    expect(translate("@@ -3,4 +3,4 @@\n X\n c\n-d\n+D\n e", "new", 1)).toEqual({
      line: 1,
      changed: false,
      inPatch: false,
    });
    expect(translate("@@ -1,2 +1,1 @@\n-a\n b", "old", 4)).toEqual({
      line: 3,
      changed: false,
      inPatch: false,
    });
    expect(
      translate("@@ -1,5 +1,6 @@\n a\n b\n+X\n c\n d\n e", "new", 3),
    ).toEqual({ line: null, changed: true, inPatch: true });
  });
  it("handles a pure insertion's zero-length side", () => {
    // insert 2 lines after old line 5
    const p = "@@ -5,0 +6,2 @@\n+p\n+q";
    expect(translate(p, "new", 5).line).toBe(5);
    expect(translate(p, "new", 8).line).toBe(6);
    expect(translate(p, "old", 6).line).toBe(8);
  });
});

describe("ownerOf", () => {
  it("gives an added line to the layer that added it", () => {
    expect(ownerOf(layers, "f", "RIGHT", 2)).toEqual({ layer: 0, line: 3 });
    expect(ownerOf(layers, "f", "RIGHT", 4)).toEqual({ layer: 1, line: 5 });
  });
  it("gives a deleted line to the layer that deleted it", () => {
    expect(ownerOf(layers, "f", "LEFT", 1)).toEqual({ layer: 2, line: 1 });
    expect(ownerOf(layers, "f", "LEFT", 4)).toEqual({ layer: 1, line: 5 });
  });
  it("falls back to the first layer showing a context line", () => {
    expect(ownerOf(layers, "f", "RIGHT", 1)).toEqual({ layer: 2, line: 1 });
  });
  it("skips layers that never touched the file", () => {
    const withGap = [layers[0], [], layers[1]];
    expect(ownerOf(withGap, "f", "RIGHT", 5)).toEqual({ layer: 2, line: 5 });
  });
});

describe("toCombined", () => {
  it("is the inverse of ownerOf", () => {
    expect(toCombined(layers, 0, "f", "RIGHT", 3)).toBe(2);
    expect(toCombined(layers, 1, "f", "RIGHT", 5)).toBe(4);
    expect(toCombined(layers, 1, "f", "LEFT", 5)).toBe(4);
    expect(toCombined(layers, 2, "f", "LEFT", 1)).toBe(1);
  });
  it("drops a line a later layer changed", () => {
    // PR1's `d` (RIGHT 5) is replaced by PR2.
    expect(toCombined(layers, 0, "f", "RIGHT", 5)).toBeNull();
  });
});

describe("routeComment", () => {
  it("collapses a range spanning two owners to its anchor", () => {
    expect(routeComment(layers, "f", "RIGHT", 4, 2)).toEqual({
      layer: 1,
      line: 5,
    });
  });
  it("keeps a range within one owner", () => {
    // D (PR2 added) and e (PR2 context) both belong to PR2.
    expect(routeComment(layers, "f", "RIGHT", 5, 4)).toEqual({
      layer: 1,
      line: 6,
      startLine: 5,
    });
  });
});

describe("lineHistory", () => {
  // base: a b c → PR1 rewrites b→B1 and adds z → PR2 rewrites B1→B2.
  const hist = [
    file("@@ -1,3 +1,4 @@\n a\n-b\n+B1\n c\n+z"),
    file("@@ -1,3 +1,3 @@\n a\n-B1\n+B2\n c"),
  ];
  const combined = file("@@ -1,3 +1,4 @@\n a\n-b\n+B2\n c\n+z")[0];

  it("walks a rewritten line down to the layer that first wrote it", () => {
    expect(lineHistory(hist, "f", 2)).toEqual([
      { layer: 0, before: ["b"], after: ["B1"] },
      { layer: 1, before: ["B1"], after: ["B2"] },
    ]);
  });
  it("gives a line one layer wrote a single touch", () => {
    expect(lineHistory(hist, "f", 4)).toEqual([
      { layer: 0, before: [], after: ["z"] },
    ]);
  });
  it("marks only blocks with two or more touches", () => {
    expect(historyMarks(hist, combined).map((m) => m.line)).toEqual([2]);
  });
  it("finds the stack fixture's rewrite of d", () => {
    // d → D is PR2 only (PR1 kept d as context), so nothing is marked.
    expect(lineHistory(layers, "f", 4).map((t) => t.layer)).toEqual([1]);
  });
});
