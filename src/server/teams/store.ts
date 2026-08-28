// Teams, persisted to ~/.tandem/teams.json. Same shape and durability story as
// views.json — validate on read, never overwrite a malformed file.
//
// NOT seeded with defaults, unlike views: a team is a claim about who your
// colleagues are, and inventing one would be wrong in a way an example query
// is not.
import { normalizeLogins, type Team } from "../../shared/team-types";
import { isPlainObject } from "../../shared/is-plain-object";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "teams.json";

function file(): string {
  return storagePath(FILE);
}

export function validateTeam(raw: unknown): Team | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  const members = normalizeLogins(
    Array.isArray(raw.members) ? raw.members : [],
  );
  return { id: raw.id, name: raw.name.trim(), members };
}

export async function loadTeams(): Promise<Team[]> {
  const text = await readTextFile(file());
  if (text === null) return [];
  try {
    const raw = JSON.parse(text) as { teams?: unknown[] };
    return (raw.teams ?? [])
      .map(validateTeam)
      .filter((t): t is Team => t !== null);
  } catch {
    console.error(
      `[teams] ${file()} is malformed; serving none without overwriting it`,
    );
    return [];
  }
}

export async function saveTeams(teams: Team[]): Promise<void> {
  await enqueueMutation(file(), () =>
    writeTextFile(file(), JSON.stringify({ teams }, null, 2)),
  );
}

/** Index by id, for the queue's per-view token expansion. */
export async function teamMap(): Promise<Map<string, Team>> {
  return new Map((await loadTeams()).map((t) => [t.id, t]));
}
