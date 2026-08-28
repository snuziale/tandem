import { describe, expect, it } from "vitest";
import { expandTeamQuery, hasTeamToken, shardTeamQuery } from "./team";
import type { Team } from "../team-types";

const team = (members: string[]): Team => ({
  id: "t1",
  name: "my team",
  members,
});

describe("hasTeamToken", () => {
  it("is false for a plain query", () => {
    expect(hasTeamToken("is:pr is:open author:@me")).toBe(false);
  });
  it("is true qualified or bare", () => {
    expect(hasTeamToken("author:{team}")).toBe(true);
    expect(hasTeamToken("is:pr {team}")).toBe(true);
  });
});

describe("expandTeamQuery", () => {
  it("repeats whatever qualifier the token is attached to", () => {
    expect(expandTeamQuery("author:{team}", team(["alice", "bob"]))).toBe(
      "author:alice author:bob",
    );
    expect(
      expandTeamQuery("review-requested:{team}", team(["alice", "bob"])),
    ).toBe("review-requested:alice review-requested:bob");
    expect(expandTeamQuery("assignee:{team}", team(["alice"]))).toBe(
      "assignee:alice",
    );
  });

  // The token is a person, and the overwhelmingly common question is "what is
  // my team shipping" — so a bare token means authors rather than erroring.
  it("treats a bare token as authors", () => {
    expect(expandTeamQuery("is:pr is:open {team}", team(["alice"]))).toBe(
      "is:pr is:open author:alice",
    );
  });

  it("expands several tokens in one query", () => {
    expect(
      expandTeamQuery("author:{team} review-requested:{team}", team(["a"])),
    ).toBe("author:a review-requested:a");
  });

  it("leaves a query with no token untouched", () => {
    const query = "is:pr is:open review-requested:@me";
    expect(expandTeamQuery(query, team(["alice"]))).toBe(query);
  });

  it("collapses the whitespace an expansion leaves behind", () => {
    expect(expandTeamQuery("is:pr  {team}  is:open", team(["a"]))).toBe(
      "is:pr author:a is:open",
    );
  });
});

describe("shardTeamQuery", () => {
  it("returns the query itself when there is no token", () => {
    expect(shardTeamQuery("is:pr is:open", null)).toEqual({
      ok: true,
      queries: ["is:pr is:open"],
    });
  });

  it("chunks the team into one query per group", () => {
    expect(
      shardTeamQuery("is:pr {team}", team(["a", "b", "c", "d", "e"]), {
        chunkSize: 2,
      }),
    ).toEqual({
      ok: true,
      queries: [
        "is:pr author:a author:b",
        "is:pr author:c author:d",
        "is:pr author:e",
      ],
    });
  });

  it("keeps the qualifier when sharding", () => {
    expect(
      shardTeamQuery("review-requested:{team}", team(["a", "b"]), {
        chunkSize: 1,
      }),
    ).toEqual({
      ok: true,
      queries: ["review-requested:a", "review-requested:b"],
    });
  });

  it("stops at the shard cap", () => {
    expect(
      shardTeamQuery("{team}", team(["a", "b", "c", "d"]), {
        chunkSize: 1,
        maxShards: 2,
      }),
    ).toEqual({ ok: true, queries: ["author:a", "author:b"] });
  });

  // The whole reason this returns a result type: an empty expansion would
  // leave a bare `is:pr is:open`, which matches all of GitHub.
  it("refuses an empty team rather than searching everything", () => {
    expect(shardTeamQuery("is:pr is:open {team}", team([]))).toEqual({
      ok: false,
      error: 'team "my team" has no members',
    });
  });

  it("refuses a token with no team attached", () => {
    expect(shardTeamQuery("is:pr {team}", null)).toEqual({
      ok: false,
      error: "this view uses {team} but no team is attached",
    });
  });
});
