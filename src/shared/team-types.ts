// A TEAM is a named list of GitHub logins you track together.
//
// That is the whole type, deliberately. It exists because the interesting
// queue questions are rarely "match this string" — they are "what is my team
// shipping", "what is my team waiting on" — and that set of people outlives
// any one query, gets reused by several views and by the menu-bar feed, and
// changes when the team changes rather than when the query does.
//
// Persisted in ~/.tandem/teams.json; referenced by SavedView.teamId and
// expanded into a search query by shared/gh/team.ts.
export type Team = {
  id: string;
  name: string;
  /** GitHub logins. No display names, no emails, no repos — a longer type was
   * tried and every extra field was carried around without being read. */
  members: string[];
};

/**
 * The one rule for what a login is: `@alice` and `alice` are the same person,
 * and the same person twice is a duplicated qualifier and a wasted shard slot,
 * never a second member.
 *
 * Shared because three surfaces have to agree — the editor's live count, the
 * store's validator, and the JSON importer. When they disagreed, the dialog
 * showed a member count the save then quietly shrank.
 */
export function normalizeLogins(raw: readonly unknown[]): string[] {
  const members: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const login = entry.trim().replace(/^@/, "");
    if (!login || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    members.push(login);
  }
  return members;
}
