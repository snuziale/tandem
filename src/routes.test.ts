import { describe, expect, it } from "vitest";
import { pathOfRoute, routeOfLocation } from "./routes";

describe("routes", () => {
  it("parses queue, settings, and PR paths", () => {
    expect(routeOfLocation("/")).toEqual({ name: "queue", viewId: null });
    expect(routeOfLocation("/settings")).toEqual({ name: "settings" });
    expect(routeOfLocation("/uipath/flow-workbench/pull/234")).toEqual({
      name: "pr",
      owner: "uipath",
      repo: "flow-workbench",
      number: 234,
      prId: "uipath/flow-workbench#234",
    });
  });

  it("reads the queue view id off the query string", () => {
    expect(routeOfLocation("/", "?view=abc-123")).toEqual({
      name: "queue",
      viewId: "abc-123",
    });
    expect(routeOfLocation("/", "?view=a%20b")).toEqual({
      name: "queue",
      viewId: "a b",
    });
    // An unrelated param must not be mistaken for a view.
    expect(routeOfLocation("/", "?other=1")).toEqual({
      name: "queue",
      viewId: null,
    });
  });

  it("falls back to queue for unknown paths", () => {
    expect(routeOfLocation("/nope")).toEqual({ name: "queue", viewId: null });
    expect(routeOfLocation("/a/b/pull/x")).toEqual({
      name: "queue",
      viewId: null,
    });
  });

  it("round-trips", () => {
    for (const [pathname, search] of [
      ["/uipath/flow-workbench/pull/234", ""],
      ["/settings", ""],
      ["/", "?view=a b"],
      ["/", ""],
    ] as const) {
      const route = routeOfLocation(pathname, search);
      const path = pathOfRoute(route);
      const [nextPath, nextSearch] = path.split("?");
      expect(
        routeOfLocation(nextPath, nextSearch ? `?${nextSearch}` : ""),
      ).toEqual(route);
    }
  });
});
