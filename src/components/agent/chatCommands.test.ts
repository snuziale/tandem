import { describe, expect, it } from "vitest";
import {
  completeMention,
  expandSlash,
  matchingCommands,
  matchingPaths,
  mentionPrefix,
  mentionedPaths,
  slashPrefix,
} from "./chatCommands";

const PATHS = [
  "src/shared/gh/patch.ts",
  "src/components/pr/DiffPane.tsx",
  "src/server/index.ts",
  "src/client/index.ts",
];

describe("slashPrefix", () => {
  it("reports the command being typed", () => {
    expect(slashPrefix("/sug")).toBe("sug");
    expect(slashPrefix("/")).toBe("");
  });

  it("stops once the command is finished", () => {
    expect(slashPrefix("/suggest ")).toBeNull();
    expect(slashPrefix("/suggest tighten this")).toBeNull();
  });

  it("is not a command mid-sentence", () => {
    expect(slashPrefix("look at a/b")).toBeNull();
  });
});

describe("matchingCommands", () => {
  it("filters by prefix", () => {
    expect(matchingCommands("re").map((c) => c.name)).toEqual(["rebut"]);
  });

  it("offers everything for a bare slash", () => {
    expect(matchingCommands("").length).toBeGreaterThan(3);
  });
});

describe("expandSlash", () => {
  it("expands a bare command", () => {
    const out = expandSlash("/rebut");
    expect(out).not.toBe("/rebut");
    expect(out.toLowerCase()).toContain("against");
  });

  it("carries the rest of the line into the question", () => {
    expect(expandSlash("/suggest use a Map here")).toContain("use a Map here");
  });

  it("leaves an unknown command completely alone", () => {
    expect(expandSlash("/notacommand do a thing")).toBe(
      "/notacommand do a thing",
    );
  });

  it("leaves ordinary prose alone", () => {
    expect(expandSlash("is this safe?")).toBe("is this safe?");
  });
});

describe("mentionPrefix", () => {
  it("reports the mention being typed at the caret", () => {
    expect(mentionPrefix("look at @patch")).toBe("patch");
    expect(mentionPrefix("@")).toBe("");
  });

  it("is null once the mention is finished", () => {
    expect(mentionPrefix("look at @patch.ts and")).toBeNull();
  });

  it("does not fire on an email-ish token", () => {
    expect(mentionPrefix("mail me@example")).toBeNull();
  });
});

describe("matchingPaths", () => {
  it("substring-matches, capped", () => {
    expect(matchingPaths("diffpane", PATHS, 5)).toEqual([
      "src/components/pr/DiffPane.tsx",
    ]);
    expect(matchingPaths("", PATHS, 2)).toHaveLength(2);
  });
});

describe("completeMention", () => {
  it("replaces the partial mention and leaves a trailing space", () => {
    expect(completeMention("look at @pat", "src/shared/gh/patch.ts")).toBe(
      "look at @src/shared/gh/patch.ts ",
    );
  });

  it("works when the mention is the whole input", () => {
    expect(completeMention("@", "a.ts")).toBe("@a.ts ");
  });
});

describe("mentionedPaths", () => {
  it("resolves a bare name the way a citation resolves", () => {
    expect(mentionedPaths("check @patch.ts please", PATHS)).toEqual([
      "src/shared/gh/patch.ts",
    ]);
  });

  it("accepts a full path", () => {
    expect(mentionedPaths("@src/server/index.ts", PATHS)).toEqual([
      "src/server/index.ts",
    ]);
  });

  it("refuses an ambiguous name rather than guessing", () => {
    expect(mentionedPaths("@index.ts", PATHS)).toEqual([]);
  });

  it("passes a full path that is NOT in the diff through to the server", () => {
    // The case the pre-load exists for: the client cannot know what else the
    // repo holds, and the server fetches it read-only and skips a miss.
    expect(mentionedPaths("@src/server/agent/live.ts", PATHS)).toEqual([
      "src/server/agent/live.ts",
    ]);
  });

  it("still ignores a bare word that is not a path", () => {
    expect(mentionedPaths("ping @here and @someone", PATHS)).toEqual([]);
  });

  it("dedupes, and ignores a bare name it cannot resolve", () => {
    expect(
      mentionedPaths("@patch.ts and @patch.ts and @nope.ts", PATHS),
    ).toEqual(["src/shared/gh/patch.ts"]);
  });
});
