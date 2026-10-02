import { describe, expect, it } from "vitest";
import {
  budgetFiles,
  joinGuidance,
  neighbourhoodPaths,
  pickContextPaths,
  relativeToRoot,
} from "./agent-context";

describe("joinGuidance", () => {
  it("keeps each file under its own heading, skipping missing and blank ones", () => {
    const out = joinGuidance(
      [
        null,
        { path: "CLAUDE.md", text: "use pnpm\n" },
        { path: "AGENTS.md", text: "   " },
        { path: ".github/copilot-instructions.md", text: "no any" },
      ],
      10_000,
    );
    expect(out).toBe(
      "#### CLAUDE.md\nuse pnpm\n\n#### .github/copilot-instructions.md\nno any",
    );
  });

  it("is null when the repo has none", () => {
    expect(joinGuidance([null, null], 1000)).toBeNull();
  });

  it("truncates against the shared budget", () => {
    const out = joinGuidance(
      [
        { path: "a", text: "x".repeat(900) },
        { path: "b", text: "y".repeat(900) },
      ],
      1000,
    )!;
    expect(out).toContain("#### a");
    expect(out).not.toContain("#### b");
  });
});

describe("budgetFiles", () => {
  it("truncates per file and lists what did not fit instead of dropping it", () => {
    const { included, omitted } = budgetFiles(
      [
        { path: "a.ts", text: "a".repeat(50) },
        { path: "b.ts", text: "b".repeat(10) },
        { path: "c.ts", text: "c".repeat(60) },
      ],
      { perFile: 40, total: 100 },
    );
    expect(included.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(included[0].text).toContain("truncated at 40");
    expect(omitted).toEqual(["c.ts"]);
  });
});

describe("neighbourhoodPaths", () => {
  const tree = [
    "src/a/one.ts",
    "src/a/one.test.ts",
    "src/a/types.ts",
    "src/b.ts",
    "src/c/deep.ts",
    "README.md",
  ];

  it("orders nearest first and never offers a changed file", () => {
    expect(neighbourhoodPaths(tree, ["src/a/one.ts"], 10)).toEqual([
      "src/a/one.test.ts",
      "src/a/types.ts",
      "src/b.ts",
      "README.md",
    ]);
  });

  it("cuts from the far end", () => {
    expect(neighbourhoodPaths(tree, ["src/a/one.ts"], 2)).toEqual([
      "src/a/one.test.ts",
      "src/a/types.ts",
    ]);
  });

  it("handles a change at the root", () => {
    expect(neighbourhoodPaths(tree, ["README.md"], 10)).toEqual([]);
  });
});

describe("pickContextPaths", () => {
  const tree = new Set(["a.ts", "b.ts", "c.ts", "d.ts"]);
  const changed = new Set(["a.ts"]);

  it("keeps only real, unchanged, unique paths up to the cap", () => {
    expect(
      pickContextPaths(
        ["a.ts", "./b.ts", "b.ts", "made/up.ts", "c.ts", "d.ts"],
        tree,
        changed,
        2,
      ),
    ).toEqual(["b.ts", "c.ts"]);
  });

  it("tolerates a plan that asked for nothing", () => {
    expect(pickContextPaths(undefined, tree, changed, 5)).toEqual([]);
  });
});

describe("relativeToRoot", () => {
  it("relativizes inside the checkout and refuses outside it", () => {
    expect(relativeToRoot("/w/tree", "/w/tree/src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("/w/tree/", "/w/tree/src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("/w/tree", "/w/treehouse/a.ts")).toBeNull();
    expect(relativeToRoot("/w/tree", "/etc/hosts")).toBeNull();
  });

  it("passes a relative path through and handles Windows separators", () => {
    expect(relativeToRoot("/w/tree", "./src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("C:\\w\\tree", "C:\\w\\tree\\src\\a.ts")).toBe(
      "src/a.ts",
    );
  });
});
