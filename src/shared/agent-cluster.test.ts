import { describe, expect, it } from "vitest";
import type { FileChange } from "./review-types";
import { analyzableFiles, clusterFiles } from "./agent-cluster";

function file(
  path: string,
  add = 10,
  del = 0,
  over: Partial<FileChange> = {},
): FileChange {
  return {
    path,
    status: "modified",
    additions: add,
    deletions: del,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    ...over,
  } as FileChange;
}

const paths = (clusters: FileChange[][]) =>
  clusters.map((c) => c.map((f) => f.path));

describe("analyzableFiles", () => {
  it("keeps files the agent can actually read", () => {
    expect(analyzableFiles([file("src/a.ts")]).map((f) => f.path)).toEqual([
      "src/a.ts",
    ]);
  });

  it("drops generated, binary and patchless files", () => {
    const out = analyzableFiles([
      file("src/a.ts"),
      file("pnpm-lock.yaml", 900, 0, { isGenerated: true }),
      file("logo.png", 0, 0, { isBinary: true }),
      file("src/huge.ts", 5000, 0, { patch: undefined }),
    ]);
    expect(out.map((f) => f.path)).toEqual(["src/a.ts"]);
  });
});

describe("clusterFiles", () => {
  it("groups by top-level directory, so a file sits with its neighbours", () => {
    expect(
      paths(
        clusterFiles([file("src/a.ts"), file("docs/b.md"), file("src/c.ts")]),
      ),
    ).toEqual([["src/a.ts", "src/c.ts"], ["docs/b.md"]]);
  });

  it("files at the repo root share one group", () => {
    expect(
      paths(clusterFiles([file("README.md"), file("package.json")])),
    ).toEqual([["README.md", "package.json"]]);
  });

  it("splits a group past the 8-file cap", () => {
    const many = Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`, 1));
    const out = clusterFiles(many);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(8);
    expect(out[1]).toHaveLength(2);
  });

  it("splits a group past the 800-line cap", () => {
    const out = clusterFiles([
      file("src/a.ts", 500),
      file("src/b.ts", 400),
      file("src/c.ts", 10),
    ]);
    expect(paths(out)).toEqual([["src/a.ts"], ["src/b.ts", "src/c.ts"]]);
  });

  it("never drops a single file that is bigger than the cap on its own", () => {
    const out = clusterFiles([file("src/huge.ts", 5000)]);
    expect(paths(out)).toEqual([["src/huge.ts"]]);
  });

  it("returns nothing for no files — a run with no passes to make", () => {
    expect(clusterFiles([])).toEqual([]);
  });
});
