import { describe, expect, it } from "vitest";
import { stripHtmlComments } from "./markdownText";

describe("stripHtmlComments", () => {
  it("removes a comment and leaves the prose", () => {
    expect(stripHtmlComments("before <!-- gone --> after")).toBe(
      "before  after",
    );
  });

  it("removes a comment spanning lines — the PR-template shape", () => {
    expect(
      stripHtmlComments("<!--\nDescribe your change\n-->\nReal body"),
    ).toBe("\nReal body");
  });

  it("removes every comment, not just the first", () => {
    expect(stripHtmlComments("<!--a-->keep<!--b-->")).toBe("keep");
  });

  it("is non-greedy, so prose between two comments survives", () => {
    expect(stripHtmlComments("<!--a-->keep me<!--b-->")).toBe("keep me");
  });

  it("leaves a body with no comments untouched", () => {
    expect(stripHtmlComments("plain body")).toBe("plain body");
  });

  it("leaves an unterminated comment alone rather than eating the body", () => {
    expect(stripHtmlComments("<!-- never closed")).toBe("<!-- never closed");
  });
});
