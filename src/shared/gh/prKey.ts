// Canonical PR identity helpers. `prId` is `"owner/repo#number"` everywhere —
// stores, query keys, routes (URL-encoded as one path segment).
import type { PrId } from "../review-types";

export type PrRef = { owner: string; repo: string; number: number };

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
  return ref ? `${ref.owner}/${ref.repo}` : null;
}

/** Cache key for agent runs: one run per (prId, headSha). */
export function runKeyOf(prId: PrId, headSha: string): string {
  return `${prId}@${headSha}`;
}
