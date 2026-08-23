import { describe, expect, it } from "vitest";
import type { FileChange } from "../review-types";
import {
  buildFilePatch,
  countDiffLines,
  diffLineIndex,
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
