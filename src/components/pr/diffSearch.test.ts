import { describe, expect, it } from "vitest";
import {
  compileMatcher,
  DEFAULT_SEARCH_OPTIONS,
  groupHits,
  MAX_HITS,
  previewOf,
  searchDiff,
  stepHit,
  type DiffHit,
  type DiffSearchOptions,
} from "./diffSearch";

const opts = (over: Partial<DiffSearchOptions> = {}): DiffSearchOptions => ({
  ...DEFAULT_SEARCH_OPTIONS,
  ...over,
});

// A whole file patch, headers included — the `+++ b/...` line is the trap a
// hand-rolled walk falls into, so every fixture here carries one.
const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,4 +10,4 @@",
  " const helper = 1;",
  "-  return oldHelper(x);",
  "+  return newHelper(x);",
  " }",
].join("\n");

const files = [{ path: "src/a.ts", patch }];

describe("searchDiff", () => {
  it("numbers a deletion on the LEFT and an addition on the RIGHT", () => {
    const { hits } = searchDiff(files, "Helper", opts());
    expect(
      hits.map((h) => `${h.side} ${h.line} ${h.kind} @${h.column}`),
    ).toEqual([
      "RIGHT 10 ctx @6", // " const helper = 1;"
      "LEFT 11 del @12", // ...oldHelper
      "RIGHT 11 add @12", // ...newHelper
    ]);
  });

  it("never reads the ---/+++ headers as a deletion and an addition", () => {
    const { hits } = searchDiff(files, "src/a.ts", opts());
    expect(hits).toEqual([]);
  });

  it("honours case sensitivity", () => {
    expect(
      searchDiff(files, "helper", opts({ caseSensitive: true })).hits,
    ).toHaveLength(1);
    expect(searchDiff(files, "helper", opts()).hits).toHaveLength(3);
  });

  it("matches whole words only when asked", () => {
    expect(
      searchDiff(files, "helper", opts({ wholeWord: true })).hits,
    ).toHaveLength(1);
  });

  it("restricts to added lines", () => {
    const { hits } = searchDiff(files, "Helper", opts({ additionsOnly: true }));
    expect(hits.map((h) => h.text.trim())).toEqual(["return newHelper(x);"]);
  });

  it("treats the term literally unless regex is on", () => {
    const dotted = ["@@ -1,2 +1,2 @@", "-a.b", "+axb"].join("\n");
    const one = [{ path: "f", patch: dotted }];
    expect(searchDiff(one, "a.b", opts()).hits).toHaveLength(1);
    expect(searchDiff(one, "a.b", opts({ regex: true })).hits).toHaveLength(2);
  });

  it("reports an unusable regex instead of reporting no matches", () => {
    const result = searchDiff(files, "return(", opts({ regex: true }));
    expect(result.error).toBeTruthy();
    expect(result.hits).toEqual([]);
  });

  it("finds every match on one line", () => {
    const twice = [{ path: "f", patch: "@@ -1,1 +1,1 @@\n+x = x + x" }];
    expect(searchDiff(twice, "x", opts()).hits.map((h) => h.column)).toEqual([
      0, 4, 8,
    ]);
  });

  it("walks files in the order it was given them", () => {
    const two = [
      { path: "b.ts", patch: "@@ -1,1 +1,1 @@\n+hit" },
      { path: "a.ts", patch: "@@ -1,1 +1,1 @@\n+hit" },
    ];
    expect(searchDiff(two, "hit", opts()).hits.map((h) => h.path)).toEqual([
      "b.ts",
      "a.ts",
    ]);
  });

  it("stops at the cap and says so", () => {
    const body = Array.from({ length: MAX_HITS + 20 }, () => "+hit").join("\n");
    const big = [
      { path: "f", patch: `@@ -1,1 +1,${MAX_HITS + 20} @@\n${body}` },
    ];
    const result = searchDiff(big, "hit", opts());
    expect(result.hits).toHaveLength(MAX_HITS);
    expect(result.truncated).toBe(true);
  });

  it("is empty for an empty term, with no error", () => {
    expect(searchDiff(files, "", opts())).toEqual({
      hits: [],
      truncated: false,
      error: null,
    });
  });
});

describe("compileMatcher", () => {
  it("is null for an empty term and a string for a broken pattern", () => {
    expect(compileMatcher("", opts())).toBeNull();
    expect(typeof compileMatcher("[", opts({ regex: true }))).toBe("string");
  });

  it("does not spin on a zero-length match", () => {
    const matcher = compileMatcher("x*", opts({ regex: true }));
    expect(matcher).not.toBeNull();
    if (!matcher || typeof matcher === "string") throw new Error("unreachable");
    expect(matcher.find("axxb")).toEqual([{ index: 1, length: 2 }]);
  });

  it("reuses one regex across calls without carrying lastIndex over", () => {
    const matcher = compileMatcher("a", opts());
    if (!matcher || typeof matcher === "string") throw new Error("unreachable");
    expect(matcher.find("aa")).toHaveLength(2);
    expect(matcher.find("aa")).toHaveLength(2);
  });
});

describe("groupHits", () => {
  it("groups in hit order and indexes each group's first hit", () => {
    const { hits } = searchDiff(
      [
        { path: "b.ts", patch: "@@ -1,1 +1,2 @@\n+hit\n+hit" },
        { path: "a.ts", patch: "@@ -1,1 +1,1 @@\n+hit" },
      ],
      "hit",
      opts(),
    );
    expect(groupHits(hits)).toEqual([
      { path: "b.ts", first: 0, hits: [hits[0], hits[1]] },
      { path: "a.ts", first: 2, hits: [hits[2]] },
    ]);
  });

  it("has nothing to group when there were no hits", () => {
    expect(groupHits([])).toEqual([]);
  });
});

describe("stepHit", () => {
  it("starts at either end depending on direction", () => {
    expect(stepHit(3, -1, 1)).toBe(0);
    expect(stepHit(3, -1, -1)).toBe(2);
  });

  it("wraps both ways", () => {
    expect(stepHit(3, 2, 1)).toBe(0);
    expect(stepHit(3, 0, -1)).toBe(2);
  });

  it("has nothing to step to in an empty list", () => {
    expect(stepHit(0, -1, 1)).toBe(-1);
  });
});

describe("previewOf", () => {
  const hit = (text: string, column: number, length: number): DiffHit => ({
    path: "f",
    side: "RIGHT",
    line: 1,
    kind: "add",
    column,
    length,
    text,
  });

  it("drops leading indentation and splits at the match", () => {
    expect(previewOf(hit("    return newHelper(x);", 11, 9))).toEqual({
      before: "return ",
      match: "newHelper",
      after: "(x);",
    });
  });

  it("keeps the indentation when the match is inside it", () => {
    expect(previewOf(hit("\t\tx", 0, 1))).toEqual({
      before: "",
      match: "\t",
      after: "\tx",
    });
  });

  it("clips both sides and marks where it cut", () => {
    const text = `${"a".repeat(60)}TARGET${"b".repeat(60)}`;
    const preview = previewOf(hit(text, 60, 6), 24);
    expect(preview.match).toBe("TARGET");
    expect(preview.before.startsWith("…")).toBe(true);
    expect(preview.after.endsWith("…")).toBe(true);
    expect(
      preview.before.length -
        1 +
        preview.match.length +
        preview.after.length -
        1,
    ).toBe(24);
  });

  it("gives the leading side the room the trailing side cannot use", () => {
    const preview = previewOf(hit(`${"a".repeat(40)}TARGET`, 40, 6), 20);
    expect(preview.after).toBe("");
    expect(preview.before).toBe(`…${"a".repeat(14)}`);
  });
});
