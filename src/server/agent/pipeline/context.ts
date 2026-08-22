// Read-side context gathering for the pipeline: the repo conventions file and
// recent commit subjects. Everything here is GitHub READS via the shared
// client — the pipeline has no other I/O surface.
import type { PrRef } from '../../../shared/gh/prKey';
import type { Config } from '../../config/store';
import { rest, GitHubError } from '../../github/client';

// Conventions are immutable per (repo, sha) — cache them; the map stays tiny.
const conventionsCache = new Map<string, string | null>();

/** `.tandem/conventions.md` at the PR's head sha, or null when absent. */
export async function fetchConventions(cfg: Config, ref: PrRef, sha: string): Promise<string | null> {
  const key = `${ref.owner}/${ref.repo}@${sha}`;
  if (conventionsCache.has(key)) return conventionsCache.get(key) ?? null;
  let value: string | null = null;
  try {
    const { data } = await rest<{ content?: string; encoding?: string }>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/contents/.tandem/conventions.md?ref=${encodeURIComponent(sha)}`
    );
    if (data.content && data.encoding === 'base64') {
      value = Buffer.from(data.content, 'base64').toString('utf8');
    }
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) {
      console.error(`[pipeline] conventions fetch failed for ${key}: ${e instanceof Error ? e.message : e}`);
    }
  }
  conventionsCache.set(key, value);
  return value;
}

/** Subjects of the last N commits on the base branch — cheap orientation. */
export async function fetchRecentCommitSubjects(cfg: Config, ref: PrRef, baseRef: string, count = 10): Promise<string[]> {
  try {
    const { data } = await rest<Array<{ commit: { message: string } }>>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(baseRef)}&per_page=${count}`
    );
    return data.map((c) => c.commit.message.split('\n')[0]);
  } catch {
    return []; // orientation garnish — never fail the run for it
  }
}
