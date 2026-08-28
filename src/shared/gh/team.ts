// Team → GitHub search query. Pure and runtime-neutral: the server expands the
// token before it searches, and the tests beside this file are the contract.
//
// A view's query stays a RAW GitHub search string — always visible, always
// editable. A team reaches it through ONE token, `{team}`, which stands in for
// a person wherever a person can go:
//
//   author:{team}            → author:alice author:bob
//   review-requested:{team}  → review-requested:alice review-requested:bob
//   {team}                   → author:alice author:bob   (the common case)
//
// So the query keeps saying what it does — you read `author:` and know it
// means authors — while the set of people behind it is free to change. One
// token, any qualifier, nothing new to learn.
//
// SHARDING is the other half. GitHub's search connection returns one page
// (Tandem asks for 50 — measured; see queueQuery.ts), so a 25-person team
// silently truncates to whoever pushed most recently. Raising the page size
// makes the search flaky, so instead the logins are chunked and each chunk
// becomes its OWN search, run in parallel — the same divergence the queue
// already makes for views, for the same reason.
import type { Team } from "../team-types";

export const TEAM_TOKEN = "{team}";

/** Logins per shard. 8 keeps each search's qualifier list short — the measured
 * cost is the search itself, and a search over 8 people returns fast. */
export const TEAM_CHUNK = 8;
/** Ceiling on searches one view may fan out to, so a 200-person team cannot
 * spend the whole rate-limit budget on a single poll. */
export const MAX_SHARDS = 8;

/** `<qualifier>:{team}` — the qualifier is repeated for every member. */
const QUALIFIED = /([A-Za-z][\w-]*):\{team\}/g;
/** A bare `{team}` means authors: it is what the token is for nine times out
 * of ten, and `author:{team}` stays available when you want to say it. */
const DEFAULT_QUALIFIER = "author";

export type ShardResult =
  { ok: true; queries: string[] } | { ok: false; error: string };

export function hasTeamToken(query: string): boolean {
  return query.includes(TEAM_TOKEN);
}

function qualifiers(prefix: string, logins: readonly string[]): string {
  return logins.map((login) => `${prefix}:${login}`).join(" ");
}

/** Collapse the whitespace an expanded token leaves behind. */
function tidy(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function substitute(query: string, logins: readonly string[]): string {
  return tidy(
    query
      .replace(QUALIFIED, (_, prefix: string) => qualifiers(prefix, logins))
      .replaceAll(TEAM_TOKEN, qualifiers(DEFAULT_QUALIFIER, logins)),
  );
}

/**
 * The token replaced against the whole team, as ONE query. Used where the
 * query is displayed rather than executed (the query bar's resolved preview).
 */
export function expandTeamQuery(
  query: string,
  team: Team | null | undefined,
): string {
  if (!hasTeamToken(query)) return query;
  return substitute(query, team?.members ?? []);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * The searches one view actually runs: the query itself without a token, or
 * the query once per chunk of the team.
 *
 * An EMPTY expansion is an error, never a query: `author:{team}` over a team
 * with no members would leave `is:pr is:open archived:false`, which matches
 * all of GitHub. Failing the view loudly is the only safe reading.
 */
export function shardTeamQuery(
  query: string,
  team: Team | null | undefined,
  opts: { chunkSize?: number; maxShards?: number } = {},
): ShardResult {
  if (!hasTeamToken(query)) return { ok: true, queries: [query] };
  if (!team)
    return {
      ok: false,
      error: "this view uses {team} but no team is attached",
    };
  if (team.members.length === 0)
    return { ok: false, error: `team "${team.name}" has no members` };

  const groups = chunk(team.members, opts.chunkSize ?? TEAM_CHUNK).slice(
    0,
    opts.maxShards ?? MAX_SHARDS,
  );
  return { ok: true, queries: groups.map((group) => substitute(query, group)) };
}

/**
 * The query a bare `?team=` feed searches, when no saved view is involved.
 *
 * Here rather than in the route because it is the one search string the SERVER
 * authors, and it has to keep saying the same thing as the query seeded into a
 * new view — the token, not a list of logins, so the team stays referenced.
 */
export function defaultTeamQuery(): string {
  return "is:pr is:open archived:false {team} sort:updated-desc";
}
