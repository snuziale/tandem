import { describe, expect, it } from "vitest";
import { parsePrId, prIdOf, repoKeyOf, runKeyOf } from "./prKey";

describe("prKey", () => {
  it("round-trips", () => {
    const id = prIdOf("uipath", "flow-workbench", 234);
    expect(id).toBe("uipath/flow-workbench#234");
    expect(parsePrId(id)).toEqual({
      owner: "uipath",
      repo: "flow-workbench",
      number: 234,
    });
    expect(repoKeyOf(id)).toBe("uipath/flow-workbench");
    expect(runKeyOf(id, "a3f9c21")).toBe("uipath/flow-workbench#234@a3f9c21");
  });

  it("rejects malformed ids", () => {
    expect(parsePrId("nope")).toBeNull();
    expect(parsePrId("a/b#x")).toBeNull();
    expect(parsePrId("a/b/c#1")).toBeNull();
    expect(repoKeyOf("nope")).toBeNull();
  });
});
