import { describe, expect, it } from "vitest";
import type { FileChange } from "../review-types";
import {
  buildFilePatch,
  clampCommentRange,
  countDiffLines,
  diffLineIndex,
  hasHunks,
  hideWhitespaceChanges,
  patchLineText,
  reversePatch,
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

describe("clampCommentRange", () => {
  // Two hunks with a gap: 10-13 on the right, then 50-51. Everything between
  // is outside the patch, exactly like expanded context.
  const patch = [
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
  ].join("\n");
  const idx = diffLineIndex(patch);

  it("keeps a range that lives entirely inside one hunk", () => {
    expect(clampCommentRange(idx, "RIGHT", 11, 13)).toEqual({
      start: 11,
      end: 13,
    });
  });

  it("normalizes an upward drag — the anchor is always the end", () => {
    expect(clampCommentRange(idx, "RIGHT", 13, 13)).toEqual({
      start: 13,
      end: 13,
    });
  });

  it("stops at the hunk edge instead of spanning the gap", () => {
    // 51 is real, 50 is real, 49 and below are not in the patch at all.
    expect(clampCommentRange(idx, "RIGHT", 20, 51)).toEqual({
      start: 50,
      end: 51,
    });
  });

  it("refuses a range whose anchor is outside the patch", () => {
    expect(clampCommentRange(idx, "RIGHT", 30, 40)).toBeNull();
  });

  it("reads the LEFT side against old-file numbering", () => {
    // old: 10 ctx, 11 gone, 12 ctx2
    expect(clampCommentRange(idx, "LEFT", 10, 12)).toEqual({
      start: 10,
      end: 12,
    });
    expect(clampCommentRange(idx, "LEFT", 10, 13)).toBeNull();
  });
});

describe("patchLineText", () => {
  const patch = [
    "diff --git a/x.ts b/x.ts",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -10,3 +10,4 @@",
    " ctx",
    "-gone",
    "+new1",
    "+new2",
    " ctx2",
  ].join("\n");

  it("returns the new-side text of a range, prefixes stripped", () => {
    expect(patchLineText(patch, "RIGHT", 11, 13)).toBe("new1\nnew2\nctx2");
  });

  it("returns the old-side text for LEFT", () => {
    expect(patchLineText(patch, "LEFT", 10, 12)).toBe("ctx\ngone\nctx2");
  });

  it("does not mistake the ---/+++ headers for body lines", () => {
    // Both would land on line 0/1 if the walker counted before the first hunk.
    expect(patchLineText(patch, "RIGHT", 10, 10)).toBe("ctx");
  });

  it("is null when any line of the range is outside the patch", () => {
    expect(patchLineText(patch, "RIGHT", 13, 14)).toBeNull();
    expect(patchLineText(patch, "RIGHT", 12, 11)).toBeNull();
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

describe("reversePatch", () => {
  it("restores a changed line from the patch's deletion side", () => {
    expect(reversePatch("a\nb2\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+b2\n c")).toBe(
      "a\nb\nc\n",
    );
  });

  it("copies everything outside the hunks straight across", () => {
    const newFile = "l1\nl2\nl3\nl4\nl5\nX\nl7\n";
    expect(reversePatch(newFile, "@@ -6,1 +6,1 @@\n-l6\n+X")).toBe(
      "l1\nl2\nl3\nl4\nl5\nl6\nl7\n",
    );
  });

  it("drops added lines and keeps added-only files intact", () => {
    expect(reversePatch("a\nnew\nb\n", "@@ -1,2 +1,3 @@\n a\n+new\n b")).toBe(
      "a\nb\n",
    );
  });

  it("honours a no-newline marker on the old side only", () => {
    expect(
      reversePatch(
        "a\nb\n",
        "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b",
      ),
    ).toBe("a\nb");
    // The same marker under a `+` line describes the NEW file — the old side
    // still ends with a newline.
    expect(
      reversePatch(
        "a\nb",
        "@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file",
      ),
    ).toBe("a\nb\n");
  });

  it("handles multiple hunks in one file", () => {
    const newFile = "1\nB\n3\n4\n5\n6\nG\n8\n";
    const patch =
      "@@ -1,3 +1,3 @@\n 1\n-b\n+B\n 3\n@@ -6,3 +6,3 @@\n 6\n-g\n+G\n 8";
    expect(reversePatch(newFile, patch)).toBe("1\nb\n3\n4\n5\n6\ng\n8\n");
  });

  it("round-trips a hide-whitespace patch to the new text (both sides agree)", () => {
    const newFile = "a\n    x\nc\n";
    const raw = "@@ -1,3 +1,3 @@\n a\n-  x\n+    x\n c\n";
    const folded = hideWhitespaceChanges(raw);
    // The hunk held nothing but whitespace, so `-w` drops it and the old side
    // reconstructs as the new file — exactly what the folded diff claims.
    expect(hasHunks(folded)).toBe(false);
    expect(reversePatch(newFile, folded)).toBe(newFile);
  });

  it("gives a folded whitespace pair the SAME text on both sides", () => {
    // The hunk mixes a real change with a whitespace-only one. `-w` keeps the
    // real change and stands the pair down to a context line carrying the NEW
    // text — so the reconstructed old side must carry that text too, or the
    // hydrated split view would re-expose the whitespace on the left.
    const newFile = "head\nB\n    ws\ntail\n";
    const raw = "@@ -1,4 +1,4 @@\n head\n-b\n+B\n-  ws\n+    ws\n tail\n";
    const folded = hideWhitespaceChanges(raw);
    expect(folded).toContain("     ws"); // context prefix + the post-change text
    expect(reversePatch(newFile, folded)).toBe("head\nb\n    ws\ntail\n");
    // Against the RAW patch the old side is the true file, whitespace and all.
    expect(reversePatch(newFile, raw)).toBe("head\nb\n  ws\ntail\n");
  });

  it("is a no-op for a patch with no hunks", () => {
    expect(reversePatch("a\nb\n", "")).toBe("a\nb\n");
  });
});
