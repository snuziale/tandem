// What a chat turn is allowed to see. Every source here is a GitHub READ
// through the shared client — same surface the pipeline has, no more.
//
// A conversation re-reads the same PR on every turn, so the detail+files pair
// is memoized per (prId, headSha) for a couple of minutes. The claude pass
// itself is the expensive part; this just keeps a chatty session from burning
// REST quota.
import type { PrRef } from "../../../shared/gh/prKey";
import type { FileChange, PrDetail } from "../../../shared/review-types";
import type { Config } from "../../config/store";
import { rest, GitHubError } from "../../github/client";
import { fetchPrFiles } from "../../github/files";
import { fetchPrDetail } from "../../github/pr";

export type ChatContextSource = { detail: PrDetail; files: FileChange[] };

const TTL_MS = 120_000;
const MAX_ENTRIES = 8;
const cache = new Map<string, { at: number; value: ChatContextSource }>();

export async function loadChatSource(
  cfg: Config,
  ref: PrRef,
  prId: string,
  headSha: string,
  signal?: AbortSignal,
): Promise<ChatContextSource> {
  const key = `${prId}@${headSha}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const detail = await fetchPrDetail(cfg, ref);
  if (!detail) throw new Error(`pull request not found: ${prId}`);
  // The sha moved under us — the caller's session is for a sha that is no
  // longer head, so say so rather than answering about the wrong code.
  if (detail.pr.headSha !== headSha)
    throw new Error(
      `new commits on ${prId} (head is now ${detail.pr.headSha.slice(0, 7)}) — reopen the PR to start a fresh thread`,
    );
  const files = await fetchPrFiles(cfg, ref, signal);
  const value: ChatContextSource = { detail, files };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}

const MAX_FILE_CHARS = 40_000;

/**
 * One whole file at the PR's head sha — the payload of a `needContext` hop.
 * Read-only, and the model never gets to name a repo: owner/repo come from the
 * session's own PR ref.
 */
export async function fetchFileAtSha(
  cfg: Config,
  ref: PrRef,
  path: string,
  sha: string,
): Promise<string | null> {
  // Path traversal is meaningless against the contents API (it resolves inside
  // the repo tree), but a leading slash or `..` just 404s — reject early.
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  try {
    const { data } = await rest<{ content?: string; encoding?: string }>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(sha)}`,
    );
    if (data.content && data.encoding === "base64") {
      const text = Buffer.from(data.content, "base64").toString("utf8");
      return text.length > MAX_FILE_CHARS
        ? `${text.slice(0, MAX_FILE_CHARS)}\n… (truncated)`
        : text;
    }
    return null;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    console.error(
      `[chat] context fetch failed for ${path}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}
