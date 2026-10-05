// Canonical PR identity helpers. `prId` is `"owner/repo#number"` everywhere —
// stores, query keys, routes (URL-encoded as one path segment).
import type { PrId } from "../review-types";

export type PrRef = { owner: string; repo: string; number: number };
/** A repository, without a PR. `"owner/name"` is its key everywhere a setting
 * is per-repo (settings.repos, settings.repoPaths). */
export type RepoRef = Pick<PrRef, "owner" | "repo">;

export function prIdOf(owner: string, repo: string, number: number): PrId {
  return `${owner}/${repo}#${number}`;
}

export function parsePrId(prId: string): PrRef | null {
  const match = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(prId);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function repoKeyOf(prId: PrId): string | null {
  const ref = parsePrId(prId);
  return ref ? repoKeyOfRef(ref) : null;
}

export function repoKeyOfRef(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/** `"owner/name"` → its parts, in the same grammar `parsePrId` reads — the ONE
 * check a per-repo settings key goes through, client and server. */
export function parseRepoKey(key: string): RepoRef | null {
  const match = /^([^/\s#]+)\/([^/\s#]+)$/.exec(key.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** Cache key for agent runs: one run per (prId, headSha). */
export function runKeyOf(prId: PrId, headSha: string): string {
  return `${prId}@${headSha}`;
}

/** A full 40-character commit sha — the only form work may be pinned to. */
export const isFullSha = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{40}$/i.test(v);
