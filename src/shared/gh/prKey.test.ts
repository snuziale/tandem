import { describe, expect, it } from "vitest";
import {
  parsePrId,
  parseRepoKey,
  prIdOf,
  repoKeyOf,
  repoKeyOfRef,
  runKeyOf,
} from "./prKey";

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

describe("parseRepoKey", () => {
  it("reads owner/name and round-trips through repoKeyOfRef", () => {
    const ref = parseRepoKey(" UiPath/flow-workbench ");
    expect(ref).toEqual({ owner: "UiPath", repo: "flow-workbench" });
    expect(repoKeyOfRef(ref!)).toBe("UiPath/flow-workbench");
  });

  it("refuses anything that is not exactly one owner and one name", () => {
    for (const key of ["", "a", "a/b/c", "a/b#1", "a /b", "/b"])
      expect(parseRepoKey(key)).toBeNull();
  });
});
