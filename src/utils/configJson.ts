// Parse/validate the pasted configuration payload for the JSON dialog — the
// views AND the teams they reference.
//
// Teams belong in here because a view carries a `teamId`, not a list of
// logins: shipping a teammate a view whose `{team}` token points at a team
// they don't have hands them a view that refuses to search. The two travel
// together or the export is broken by construction.
//
// Pure — tested.
import { isPlainObject } from "../shared/is-plain-object";
import type { SavedView } from "../shared/review-types";
import { normalizeLogins, type Team } from "../shared/team-types";

export type TandemConfig = {
  views: SavedView[];
  /** Null = the payload said nothing about teams, so leave them alone. An
   * empty array is a real instruction to clear them. */
  teams: Team[] | null;
};

export type ConfigParseResult = TandemConfig | { error: string };

function parseViews(raw: unknown[]): SavedView[] | { error: string } {
  const views: SavedView[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.query !== "string" ||
      !entry.query.trim()
    ) {
      return { error: `view ${i}: name and query are required strings` };
    }
    views.push({
      id:
        typeof entry.id === "string" && entry.id
          ? entry.id
          : crypto.randomUUID(),
      name: entry.name,
      query: entry.query,
      agentEnabled: entry.agentEnabled === true,
      // Round-tripped verbatim: a team-backed view that silently lost its team
      // would search all of GitHub on the other end.
      teamId:
        typeof entry.teamId === "string" && entry.teamId
          ? entry.teamId
          : undefined,
      position: typeof entry.position === "number" ? entry.position : i,
    });
  }
  if (views.length === 0) return { error: "at least one view is required" };
  return views;
}

function parseTeams(raw: unknown[]): Team[] | { error: string } {
  const teams: Team[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== "string" ||
      !entry.name.trim()
    ) {
      return { error: `team ${i}: name is a required string` };
    }
    if (!Array.isArray(entry.members))
      return { error: `team ${i}: members must be an array of logins` };
    teams.push({
      id:
        typeof entry.id === "string" && entry.id
          ? entry.id
          : crypto.randomUUID(),
      name: entry.name,
      // Same rule as the store and the editor: an import that kept `@alice`
      // and `alice` as two members would show a count the save then shrinks.
      members: normalizeLogins(entry.members),
    });
  }
  return teams;
}

export function parseConfigJson(text: string): ConfigParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      error: `invalid JSON: ${e instanceof Error ? e.message : "parse error"}`,
    };
  }

  // A bare array is the OLD export shape (views only) and still imports —
  // people have those copied into notes and chat threads.
  if (Array.isArray(raw)) {
    const views = parseViews(raw);
    return "error" in views ? views : { views, teams: null };
  }

  if (!isPlainObject(raw) || !Array.isArray(raw.views))
    return {
      error: "expected { views: [...], teams: [...] } or an array of views",
    };

  const views = parseViews(raw.views);
  if ("error" in views) return views;
  if (raw.teams === undefined) return { views, teams: null };
  if (!Array.isArray(raw.teams)) return { error: "teams must be an array" };
  const teams = parseTeams(raw.teams);
  return "error" in teams ? teams : { views, teams };
}

/** What the dialog shows, and what Copy puts on the clipboard. */
export function formatConfigJson(views: SavedView[], teams: Team[]): string {
  return JSON.stringify({ views, teams }, null, 2);
}
