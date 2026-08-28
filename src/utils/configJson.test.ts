import { describe, expect, it } from "vitest";
import { formatConfigJson, parseConfigJson } from "./configJson";

const view = { name: "Repo only", query: "is:pr repo:a/b" };

describe("parseConfigJson", () => {
  it("accepts the object shape and fills id/position defaults", () => {
    const result = parseConfigJson(JSON.stringify({ views: [view] }));
    expect("views" in result).toBe(true);
    if (!("views" in result)) return;
    expect(result.views[0].name).toBe("Repo only");
    expect(result.views[0].id).toBeTruthy();
    expect(result.views[0].position).toBe(0);
    expect(result.views[0].agentEnabled).toBe(false);
  });

  it("reads teams alongside views", () => {
    const result = parseConfigJson(
      JSON.stringify({
        views: [{ ...view, teamId: "t1" }],
        teams: [{ id: "t1", name: "Core", members: ["alice", "bob"] }],
      }),
    );
    expect("views" in result).toBe(true);
    if (!("views" in result)) return;
    expect(result.views[0].teamId).toBe("t1");
    expect(result.teams).toEqual([
      { id: "t1", name: "Core", members: ["alice", "bob"] },
    ]);
  });

  // A view's teamId is worthless to the person you sent it to without the
  // team, so the two have to survive the same round trip.
  it("round-trips views and teams through format", () => {
    const views = [
      {
        id: "v1",
        name: "A",
        query: "author:{team}",
        agentEnabled: true,
        teamId: "t1",
        position: 0,
      },
    ];
    const teams = [{ id: "t1", name: "Core", members: ["alice"] }];
    const result = parseConfigJson(formatConfigJson(views, teams));
    expect(result).toEqual({ views, teams });
  });

  // Old exports live in notes and chat threads; they should still import.
  it("still accepts a bare array of views, and says teams were unspecified", () => {
    const result = parseConfigJson(JSON.stringify([view]));
    expect("views" in result).toBe(true);
    if (!("views" in result)) return;
    expect(result.views).toHaveLength(1);
    expect(result.teams).toBeNull();
  });

  it("distinguishes 'no teams key' from 'clear the teams'", () => {
    expect(parseConfigJson(JSON.stringify({ views: [view] }))).toHaveProperty(
      "teams",
      null,
    );
    expect(
      parseConfigJson(JSON.stringify({ views: [view], teams: [] })),
    ).toHaveProperty("teams", []);
  });

  it("rejects malformed payloads with a pointed error", () => {
    expect(parseConfigJson("not json")).toHaveProperty("error");
    expect(parseConfigJson("{}")).toEqual({
      error: "expected { views: [...], teams: [...] } or an array of views",
    });
    expect(parseConfigJson(JSON.stringify({ views: [] }))).toEqual({
      error: "at least one view is required",
    });
    expect(
      parseConfigJson(JSON.stringify({ views: [{ name: "", query: "x" }] })),
    ).toEqual({ error: "view 0: name and query are required strings" });
    expect(
      parseConfigJson(JSON.stringify({ views: [view], teams: "nope" })),
    ).toEqual({ error: "teams must be an array" });
    expect(
      parseConfigJson(
        JSON.stringify({ views: [view], teams: [{ name: "Core" }] }),
      ),
    ).toEqual({ error: "team 0: members must be an array of logins" });
    expect(
      parseConfigJson(
        JSON.stringify({ views: [view], teams: [{ name: "", members: [] }] }),
      ),
    ).toEqual({ error: "team 0: name is a required string" });
  });

  it("preserves explicit ids and positions", () => {
    const views = [
      { id: "v1", name: "A", query: "q", agentEnabled: true, position: 3 },
    ];
    const result = parseConfigJson(JSON.stringify({ views }));
    if (!("views" in result)) throw new Error("expected views");
    expect(result.views[0].id).toBe("v1");
    expect(result.views[0].position).toBe(3);
    expect(result.views[0].agentEnabled).toBe(true);
  });
});
