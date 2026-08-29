import { describe, expect, it } from "vitest";
import { findCodeRefs, resolveCodeRef } from "./codeRefs";

describe("findCodeRefs", () => {
  it("finds a bare basename reference", () => {
    const [hit] = findCodeRefs("The walk at patch.ts:213 goes too far.");
    expect(hit.ref).toEqual({
      path: "patch.ts",
      line: 213,
      startLine: undefined,
    });
    expect(hit.text).toBe("patch.ts:213");
  });

  it("finds a full path reference", () => {
    const [hit] = findCodeRefs("see src/shared/gh/patch.ts:212 for the clamp");
    expect(hit.ref.path).toBe("src/shared/gh/patch.ts");
    expect(hit.ref.line).toBe(212);
  });

  it("reads a range as end-anchored, like every other anchor", () => {
    const [hit] = findCodeRefs("DiffPane.tsx:40-52 is the block");
    expect(hit.ref).toEqual({
      path: "DiffPane.tsx",
      line: 52,
      startLine: 40,
    });
  });

  it("normalizes a backwards range instead of dropping it", () => {
    const [hit] = findCodeRefs("a.ts:52-40");
    expect(hit.ref).toEqual({ path: "a.ts", line: 52, startLine: 40 });
  });

  it("finds several in one paragraph", () => {
    const hits = findCodeRefs("both a.ts:1 and b/c.tsx:22 are wrong");
    expect(hits.map((h) => h.text)).toEqual(["a.ts:1", "b/c.tsx:22"]);
  });

  it("reports offsets that address the original string", () => {
    const text = "look at patch.ts:213 now";
    const [hit] = findCodeRefs(text);
    expect(text.slice(hit.start, hit.end)).toBe("patch.ts:213");
  });

  it("ignores things that only look like a reference", () => {
    expect(findCodeRefs("severity:3 and 10:30 and localhost:5274")).toEqual([]);
    expect(findCodeRefs("a plain sentence about patch.ts itself")).toEqual([]);
  });

  it("does not fire inside a URL", () => {
    expect(findCodeRefs("https://x.dev/a.ts:12")).toEqual([]);
  });

  it("leaves trailing punctuation out of the match", () => {
    const [hit] = findCodeRefs("(see patch.ts:213).");
    expect(hit.text).toBe("patch.ts:213");
  });
});

describe("resolveCodeRef", () => {
  const paths = [
    "src/shared/gh/patch.ts",
    "src/components/pr/DiffPane.tsx",
    "src/server/index.ts",
    "src/client/index.ts",
  ];

  it("passes an exact path straight through", () => {
    expect(
      resolveCodeRef({ path: "src/shared/gh/patch.ts", line: 1 }, paths),
    ).toBe("src/shared/gh/patch.ts");
  });

  it("resolves a basename to the one file that ends with it", () => {
    expect(resolveCodeRef({ path: "patch.ts", line: 1 }, paths)).toBe(
      "src/shared/gh/patch.ts",
    );
  });

  it("matches only on a segment boundary", () => {
    expect(resolveCodeRef({ path: "atch.ts", line: 1 }, paths)).toBeNull();
  });

  it("refuses to guess between two files with the same name", () => {
    expect(resolveCodeRef({ path: "index.ts", line: 1 }, paths)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(resolveCodeRef({ path: "nope.ts", line: 1 }, paths)).toBeNull();
  });
});
