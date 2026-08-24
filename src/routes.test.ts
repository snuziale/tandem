import { describe, expect, it } from "vitest";
import { pathOfRoute, routeOfLocation } from "./routes";

describe("routes", () => {
  it("parses queue, settings, and PR paths", () => {
    expect(routeOfLocation("/")).toEqual({
      name: "queue",
      viewId: null,
      facet: null,
    });
    expect(routeOfLocation("/settings")).toEqual({ name: "settings" });
    expect(routeOfLocation("/acme/web/pull/234")).toEqual({
      name: "pr",
      owner: "acme",
      repo: "web",
      number: 234,
      prId: "acme/web#234",
    });
  });

  it("reads the queue view id off the query string", () => {
    expect(routeOfLocation("/", "?view=abc-123")).toEqual({
      name: "queue",
      viewId: "abc-123",
      facet: null,
    });
    expect(routeOfLocation("/", "?view=a%20b")).toEqual({
      name: "queue",
      viewId: "a b",
      facet: null,
    });
    // An unrelated param must not be mistaken for a view.
    expect(routeOfLocation("/", "?other=1")).toEqual({
      name: "queue",
      viewId: null,
      facet: null,
    });
  });

  it("reads the stats facet, independently of the view", () => {
    expect(routeOfLocation("/", "?view=v1&by=author%3Aalice")).toEqual({
      name: "queue",
      viewId: "v1",
      facet: "author:alice",
    });
    expect(routeOfLocation("/", "?by=idle%3A%3E7d")).toEqual({
      name: "queue",
      viewId: null,
      facet: "idle:>7d",
    });
  });

  it("falls back to queue for unknown paths", () => {
    expect(routeOfLocation("/nope")).toEqual({
      name: "queue",
      viewId: null,
      facet: null,
    });
    expect(routeOfLocation("/a/b/pull/x")).toEqual({
      name: "queue",
      viewId: null,
      facet: null,
    });
  });

  it("round-trips", () => {
    for (const [pathname, search] of [
      ["/acme/web/pull/234", ""],
      ["/settings", ""],
      ["/", "?view=a b"],
      ["/", "?view=v1&by=idle%3A%3E7d"],
      ["/", "?by=repo%3Aacme%2Fweb"],
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
