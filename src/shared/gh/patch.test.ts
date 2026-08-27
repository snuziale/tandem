import { describe, expect, it } from "vitest";
import type { FileChange } from "../review-types";
import {
  buildFilePatch,
  countDiffLines,
  diffLineIndex,
  hasHunks,
  hideWhitespaceChanges,
  splitRawDiff,
} from "./patch";

const base: FileChange = {
  path: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1,2 +1,2 @@\n-old\n+new\n context",
  isBinary: false,
  isGenerated: false,
};

describe("buildFilePatch", () => {
  it("wraps modified-file hunks with git headers", () => {
    expect(buildFilePatch(base)).toBe(
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n",
    );
  });

  it("marks added and removed files with /dev/null sides", () => {
    expect(buildFilePatch({ ...base, status: "added" })).toContain(
      "--- /dev/null",
    );
    expect(buildFilePatch({ ...base, status: "added" })).toContain(
      "new file mode",
    );
    expect(buildFilePatch({ ...base, status: "removed" })).toContain(
      "+++ /dev/null",
    );
  });

  it("records renames", () => {
    const patch = buildFilePatch({
      ...base,
      status: "renamed",
      previousPath: "src/old.ts",
    })!;
    expect(patch).toContain("diff --git a/src/old.ts b/src/a.ts");
    expect(patch).toContain("rename from src/old.ts");
    expect(patch).toContain("rename to src/a.ts");
  });

  it("returns null when the API withheld the patch", () => {
    expect(buildFilePatch({ ...base, patch: undefined })).toBeNull();
  });
});

describe("splitRawDiff", () => {
  const raw = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "",
  ].join("\n");

  it("splits per file, keyed by new path (old path for deletions)", () => {
    const map = splitRawDiff(raw);
    expect([...map.keys()]).toEqual(["src/a.ts", "gone.ts"]);
    expect(map.get("src/a.ts")).toContain("+y");
    expect(map.get("gone.ts")).toContain("deleted file mode");
  });

  it("handles empty input", () => {
    expect(splitRawDiff("").size).toBe(0);
  });
});

describe("countDiffLines", () => {
  it("sums additions and deletions", () => {
    expect(
      countDiffLines([
        { additions: 3, deletions: 1 },
        { additions: 0, deletions: 2 },
      ]),
    ).toBe(6);
  });
});

describe("diffLineIndex", () => {
  it("tracks per-side anchorable lines through hunks", () => {
    const patch = [
      "@@ -10,3 +10,4 @@",
      " ctx",
      "-gone",
      "+new1",
      "+new2",
      " ctx2",
    ].join("\n");
    const idx = diffLineIndex(patch);
    // old: 10 ctx, 11 gone, 12 ctx2 · new: 10 ctx, 11 new1, 12 new2, 13 ctx2
    expect([...idx.left]).toEqual([10, 11, 12]);
    expect([...idx.right]).toEqual([10, 11, 12, 13]);
  });

  it("handles multiple hunks and no-newline markers", () => {
    const patch = [
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "\\ No newline at end of file",
      "@@ -50,2 +50,2 @@",
      " x",
      "-y",
      "+z",
    ].join("\n");
    const idx = diffLineIndex(patch);
    expect(idx.left.has(1)).toBe(true);
    expect(idx.right.has(1)).toBe(true);
    expect(idx.left.has(51)).toBe(true);
    expect(idx.right.has(51)).toBe(true);
    expect(idx.right.has(2)).toBe(false);
  });
});

describe("hideWhitespaceChanges", () => {
  const keep = (left: number[] = [], right: number[] = []) => ({
    left: new Set(left),
    right: new Set(right),
  });

  it("collapses an indent-only change into a context line", () => {
    const patch = "@@ -1,4 +1,4 @@\n-  b();\n+    b();\n-old\n+new\n";
    expect(hideWhitespaceChanges(patch)).toBe(
      "@@ -1,4 +1,4 @@\n     b();\n-old\n+new\n",
    );
  });

  it("drops a hunk that was nothing but a reindent", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n-  b();\n+    b();\n c\n";
    expect(hideWhitespaceChanges(patch)).toBe("\n");
    expect(hasHunks(hideWhitespaceChanges(patch))).toBe(false);
  });

  it("keeps the hunk counts, so line numbers never move", () => {
    const patch = "@@ -10,4 +20,4 @@ fn()\n a\n-  b\n+\tb\n-x\n+y\n";
    const out = hideWhitespaceChanges(patch).split("\n");
    expect(out[0]).toBe("@@ -10,4 +20,4 @@ fn()");
    expect(out.slice(1, -1)).toEqual([" a", " \tb", "-x", "+y"]);
  });

  it("drops a hunk whose changes were all whitespace", () => {
    const patch =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-a\n+ a\n";
    const out = hideWhitespaceChanges(patch);
    expect(hasHunks(out)).toBe(false);
    expect(out).toBe("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n");
  });

  it("leaves real changes alone", () => {
    const patch = "@@ -1,2 +1,2 @@\n-old\n+new\n context\n";
    expect(hideWhitespaceChanges(patch)).toBe(patch);
  });

  it("folds only the whitespace pairs inside a mixed run", () => {
    const patch = "@@ -1,4 +1,4 @@\n-  a\n-old\n-  c\n+    a\n+new\n+    c\n";
    expect(hideWhitespaceChanges(patch)).toBe(
      "@@ -1,4 +1,4 @@\n     a\n-old\n+new\n     c\n",
    );
  });

  it("matches across an inserted line without renumbering", () => {
    const patch = "@@ -1,2 +1,3 @@\n-  a\n-  b\n+extra\n+    a\n+    b\n";
    expect(hideWhitespaceChanges(patch)).toBe(
      "@@ -1,2 +1,3 @@\n+extra\n     a\n     b\n",
    );
  });

  it("never folds a line something is anchored to", () => {
    const patch = "@@ -1,2 +1,2 @@\n a\n-  b\n+    b\n";
    expect(hideWhitespaceChanges(patch, keep([], [2]))).toBe(patch);
    expect(hideWhitespaceChanges(patch, keep([2], []))).toBe(patch);
  });

  it("keeps an otherwise-empty hunk that holds an anchor", () => {
    const patch = "@@ -5,2 +5,2 @@\n ctx\n-  b\n+    b\n";
    // The anchor is on the context line, not on the folded pair.
    expect(hideWhitespaceChanges(patch, keep([5], []))).toBe(
      "@@ -5,2 +5,2 @@\n ctx\n     b\n",
    );
  });

  it("drops the no-newline marker with the line it belonged to", () => {
    const patch =
      "@@ -1,2 +1,2 @@\n-x\n+y\n-a \n\\ No newline at end of file\n+a\n";
    expect(hideWhitespaceChanges(patch)).toBe("@@ -1,2 +1,2 @@\n-x\n+y\n a\n");
  });

  it("renumbers nothing: the folded patch indexes the same lines", () => {
    const patch = "@@ -1,4 +1,4 @@\n a\n-  b\n+\tb\n-c\n+d\n e\n";
    const before = diffLineIndex(patch);
    const after = diffLineIndex(hideWhitespaceChanges(patch));
    expect([...after.left]).toEqual([...before.left]);
    expect([...after.right]).toEqual([...before.right]);
  });
});
