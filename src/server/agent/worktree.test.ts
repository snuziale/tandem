import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { expandHome, remoteMatches } from "./worktree";

const ref = { owner: "UiPath", repo: "flow-workbench", number: 1 };

describe("remoteMatches", () => {
  it("accepts every GitHub URL spelling, case-insensitively", () => {
    for (const url of [
      "https://github.com/UiPath/flow-workbench.git",
      "https://github.com/uipath/flow-workbench",
      "git@github.com:UiPath/flow-workbench.git",
      "ssh://git@github.com/UiPath/flow-workbench.git",
    ])
      expect(remoteMatches(url, ref)).toBe(true);
  });

  it("refuses another repo, a prefix of this one, or another host", () => {
    for (const url of [
      "https://github.com/UiPath/flow-workbench-2.git",
      "https://github.com/UiPath/flow.git",
      "https://gitlab.com/UiPath/flow-workbench.git",
      "https://github.com/someone/flow-workbench.git",
    ])
      expect(remoteMatches(url, ref)).toBe(false);
  });
});

describe("expandHome", () => {
  it("expands a leading ~ only", () => {
    expect(expandHome("~/code/x")).toBe(`${homedir()}/code/x`);
    expect(expandHome("/abs/~/x")).toBe("/abs/~/x");
  });
});
