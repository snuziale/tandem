import { describe, expect, it } from "vitest";
import { parsePrId, prIdOf, repoKeyOf, runKeyOf } from "./prKey";

describe("prKey", () => {
  it("round-trips", () => {
    const id = prIdOf("acme", "web", 234);
    expect(id).toBe("acme/web#234");
    expect(parsePrId(id)).toEqual({
      owner: "acme",
      repo: "web",
      number: 234,
    });
    expect(repoKeyOf(id)).toBe("acme/web");
    expect(runKeyOf(id, "a3f9c21")).toBe("acme/web#234@a3f9c21");
  });

  it("rejects malformed ids", () => {
    expect(parsePrId("nope")).toBeNull();
    expect(parsePrId("a/b#x")).toBeNull();
    expect(parsePrId("a/b/c#1")).toBeNull();
    expect(repoKeyOf("nope")).toBeNull();
  });
});
