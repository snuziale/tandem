// Read-side context gathering for the pipeline: the repo's guidance files,
// its tree, whole files at the head sha, and recent commit subjects.
// Everything here is GitHub READS via the shared client. (A `repo`-context
// profile ALSO reads a local checkout — that is agent/worktree.ts, and the
// model does the reading there, through the CLI's confined read-only tools.)
import { repoKeyOfRef, type PrRef } from "../../../shared/gh/prKey";
import type { Config } from "../../config/store";
import {
  joinGuidance,
  REPO_GUIDANCE_FILES,
  type ContextFile,
} from "../../../shared/agent-context";
import { rest } from "../../github/client";
import { fetchFileAtRef } from "../../github/files";

// Guidance is immutable per (repo, sha) and read by every pass and every chat
// turn, so it is cached — as the PROMISE, so a run and a chat turn arriving
// together share one set of reads. A result that hit a transient error is
// evicted rather than kept as "this repo has no guidance" for the process's
// lifetime.
const guidanceCache = new Map<string, Promise<string | null>>();
const CACHE_CAP = 32;

/** Guidance is capped as a whole — it sits in EVERY pass's prompt. */
const MAX_GUIDANCE_CHARS = 12_000;

/**
 * The repo's own instructions to agents at the PR's head sha —
 * `.tandem/conventions.md`, then CLAUDE.md / AGENTS.md /
 * .github/copilot-instructions.md (REPO_GUIDANCE_FILES) — joined under their
 * own names. Null when the repo has none. It used to read only the `.tandem/`
 * file, which nobody writes; most repos already carry one of the others.
 */
export async function fetchRepoGuidance(
  cfg: Config,
  ref: PrRef,
  sha: string,
): Promise<string | null> {
  const key = `${repoKeyOfRef(ref)}@${sha}`;
  const hit = guidanceCache.get(key);
  if (hit) return hit;
  let failed = false;
  const pending = Promise.all(
    REPO_GUIDANCE_FILES.map(async (path) => {
      const text = await readFileOrNull(cfg, ref, path, sha, undefined, () => {
        failed = true;
      });
      return text === null ? null : { path, text };
    }),
  ).then((found) => {
    if (failed) guidanceCache.delete(key);
    return joinGuidance(found, MAX_GUIDANCE_CHARS);
  });
  guidanceCache.set(key, pending);
  if (guidanceCache.size > CACHE_CAP)
    guidanceCache.delete(guidanceCache.keys().next().value!);
  return pending;
}

/**
 * One file at `sha`, or null — absent (404, directory, oversized) AND
 * unreadable alike, because every caller treats a file it cannot read as
 * context it goes without. An error is logged and reported to `onError`; an
 * abort still throws.
 */
export async function readFileOrNull(
  cfg: Config,
  ref: PrRef,
  path: string,
  sha: string,
  signal?: AbortSignal,
  onError?: () => void,
): Promise<string | null> {
  try {
    return await fetchFileAtRef(cfg, ref, path, sha, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    onError?.();
    console.error(
      `[agent] file fetch failed for ${repoKeyOfRef(ref)}:${path}@${sha.slice(0, 7)}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

/**
 * Every blob path in the tree at `sha` — ONE request, which is what lets
 * pass 1 pick related files by name without a listing call per directory.
 * GitHub truncates a very large tree; what it returned is still a usable
 * menu, so a truncated tree is used as-is. Empty on failure: the menu is
 * garnish, never a reason to fail the run. NOT cached: a run reads it once
 * and keeps only the ~150-path neighbourhood, and a monorepo's full tree is
 * megabytes nobody asks for twice.
 */
export async function fetchTreePaths(
  cfg: Config,
  ref: PrRef,
  sha: string,
): Promise<string[]> {
  try {
    const { data } = await rest<{
      tree?: Array<{ path?: string; type?: string }>;
    }>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    );
    return (data.tree ?? [])
      .filter((e) => e.type === "blob" && typeof e.path === "string")
      .map((e) => e.path!);
  } catch (e) {
    console.error(
      `[pipeline] tree fetch failed for ${repoKeyOfRef(ref)}@${sha.slice(0, 7)}: ${e instanceof Error ? e.message : e}`,
    );
    return [];
  }
}

const FETCH_CONCURRENCY = 6;

/** Whole files at `sha`, concurrently but bounded; a file that cannot be read
 * (deleted, binary, oversized) is simply absent from the result. */
export async function fetchFilesAt(
  cfg: Config,
  ref: PrRef,
  sha: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<ContextFile[]> {
  const out: Array<ContextFile | null> = new Array(paths.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      const text = await readFileOrNull(cfg, ref, paths[i], sha, signal);
      if (text !== null) out[i] = { path: paths[i], text };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, worker),
  );
  return out.filter((f): f is ContextFile => f !== null);
}

/** Subjects of the last N commits on the base branch — cheap orientation. */
export async function fetchRecentCommitSubjects(
  cfg: Config,
  ref: PrRef,
  baseRef: string,
  count = 10,
): Promise<string[]> {
  try {
    const { data } = await rest<Array<{ commit: { message: string } }>>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(baseRef)}&per_page=${count}`,
    );
    return data.map((c) => c.commit.message.split("\n")[0]);
  } catch {
    return []; // orientation garnish — never fail the run for it
  }
}
