import { describe, expect, it } from "vitest";
import {
  parseLineCommentRequest,
  parseReplyRequest,
  restCommentOf,
} from "./reviewComment";

const SHA = "a".repeat(40);

describe("restCommentOf", () => {
  it("omits start_line for a one-line range", () => {
    expect(
      restCommentOf({
        path: "a.ts",
        line: 4,
        startLine: 4,
        side: "RIGHT",
        body: "x",
      }),
    ).toEqual({ path: "a.ts", line: 4, side: "RIGHT", body: "x" });
  });

  it("sends a range with start_side matching side", () => {
    expect(
      restCommentOf({
        path: "a.ts",
        line: 6,
        startLine: 2,
        side: "LEFT",
        body: "x",
      }),
    ).toMatchObject({ start_line: 2, start_side: "LEFT", line: 6 });
  });

  it("fences a suggestion under the body, or alone", () => {
    const base = { path: "a.ts", line: 1, side: "RIGHT" as const };
    expect(restCommentOf({ ...base, body: "try", suggestion: "y" }).body).toBe(
      "try\n\n```suggestion\ny\n```",
    );
    expect(restCommentOf({ ...base, body: "", suggestion: "y" }).body).toBe(
      "```suggestion\ny\n```",
    );
  });
});

describe("parseLineCommentRequest", () => {
  const ok = {
    headSha: SHA,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    body: "  hi  ",
  };

  it("accepts a minimal comment and trims the body", () => {
    expect(parseLineCommentRequest(ok)).toEqual({
      commitId: SHA,
      comment: { path: "src/a.ts", line: 10, side: "RIGHT", body: "hi" },
    });
  });

  it("carries a range and a suggestion", () => {
    const r = parseLineCommentRequest({
      ...ok,
      startLine: 8,
      suggestion: "z",
    });
    expect(r).toMatchObject({ comment: { startLine: 8, suggestion: "z" } });
  });

  it("allows an empty body when a suggestion carries the comment", () => {
    expect(
      parseLineCommentRequest({ ...ok, body: "", suggestion: "" }),
    ).not.toHaveProperty("error");
  });

  it("refuses what GitHub would 422 or misplace", () => {
    expect(parseLineCommentRequest({ ...ok, headSha: "abc" })).toHaveProperty(
      "error",
    );
    expect(
      parseLineCommentRequest({ ...ok, headSha: undefined }),
    ).toHaveProperty("error");
    expect(parseLineCommentRequest({ ...ok, line: 0 })).toHaveProperty("error");
    expect(parseLineCommentRequest({ ...ok, side: "BOTH" })).toHaveProperty(
      "error",
    );
    expect(parseLineCommentRequest({ ...ok, startLine: 11 })).toHaveProperty(
      "error",
    );
    expect(parseLineCommentRequest({ ...ok, body: "   " })).toHaveProperty(
      "error",
    );
    expect(parseLineCommentRequest(null)).toHaveProperty("error");
  });
});

describe("parseReplyRequest", () => {
  it("accepts a reply and trims it", () => {
    expect(parseReplyRequest({ commentId: 42, body: " ok " })).toEqual({
      commentId: 42,
      body: "ok",
    });
  });

  it("refuses a missing id or an empty body", () => {
    expect(parseReplyRequest({ body: "ok" })).toHaveProperty("error");
    expect(parseReplyRequest({ commentId: "42", body: "ok" })).toHaveProperty(
      "error",
    );
    expect(parseReplyRequest({ commentId: 42, body: "  " })).toHaveProperty(
      "error",
    );
  });
});
