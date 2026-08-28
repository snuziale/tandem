import { describe, expect, it } from "vitest";
import { appendQualifier, hasScopeQualifier } from "./searchQuery";

describe("appendQualifier", () => {
  it("separates with exactly one space", () => {
    expect(appendQualifier("is:pr is:open", "repo:acme/web")).toBe(
      "is:pr is:open repo:acme/web",
    );
    expect(appendQualifier("is:pr is:open   ", "repo:acme/web")).toBe(
      "is:pr is:open repo:acme/web",
    );
  });

  it("does not lead with a space on an empty query", () => {
    expect(appendQualifier("", "repo:acme/web")).toBe("repo:acme/web");
    expect(appendQualifier("   ", "repo:acme/web")).toBe("repo:acme/web");
  });
});

describe("hasScopeQualifier", () => {
  it("recognizes repo, org and person qualifiers", () => {
    expect(hasScopeQualifier("is:pr repo:acme/web")).toBe(true);
    expect(hasScopeQualifier("org:acme is:open")).toBe(true);
    expect(hasScopeQualifier("review-requested:@me")).toBe(true);
    expect(hasScopeQualifier("author:{team}")).toBe(true);
  });

  it("is false for a query that would match all of GitHub", () => {
    expect(hasScopeQualifier("is:pr is:open archived:false")).toBe(false);
    expect(hasScopeQualifier("")).toBe(false);
  });

  it("does not match a qualifier with no value", () => {
    expect(hasScopeQualifier("is:pr repo:")).toBe(false);
  });

  it("does not match a bare word ending in a scoping name", () => {
    expect(hasScopeQualifier("refactor:things")).toBe(false);
  });
});
