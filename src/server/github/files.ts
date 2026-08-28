// GET /api/prs/:owner/:repo/:number/files — the PR's changed files with
// per-file patches, with the documented REST limits handled explicitly:
// the files list stops at 300 entries, and `patch` is omitted for oversized
// files. Both fall back to the whole-PR raw diff (Accept: vnd.github.diff);
// anything still missing a patch is marked tooLarge for the UI to degrade to
// "open on GitHub".
import { normalizeFile } from "../../shared/gh/normalize";
import { splitRawDiff } from "../../shared/gh/patch";
import type { PrRef } from "../../shared/gh/prKey";
import type { RestPullFile } from "../../shared/gh/wire";
import type { FileChange } from "../../shared/review-types";
import type { Config } from "../config/store";
import { rest, GitHubError } from "./client";

const PER_PAGE = 100;
const FILES_API_WINDOW = 300;
// A raw diff bigger than this is beyond anything the UI should try to render.
const MAX_RAW_DIFF_BYTES = 5_000_000;

export async function fetchPrFiles(
  cfg: Config,
  ref: PrRef,
  signal?: AbortSignal,
): Promise<FileChange[]> {
  const files: FileChange[] = [];
  for (let page = 1; page <= FILES_API_WINDOW / PER_PAGE; page++) {
    const { data } = await rest<RestPullFile[]>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=${PER_PAGE}&page=${page}`,
      { signal },
    );
    files.push(...data.map(normalizeFile));
    if (data.length < PER_PAGE) break;
  }

  const needsFallback = files.some((f) => f.patch === undefined && !f.isBinary);
  if (needsFallback) {
    await hydrateFromRawDiff(cfg, ref, files, signal);
  }
  return files;
}

async function hydrateFromRawDiff(
  cfg: Config,
  ref: PrRef,
  files: FileChange[],
  signal?: AbortSignal,
): Promise<void> {
  let raw: string;
  try {
    const result = await rest<string>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
      {
        accept: "application/vnd.github.diff",
        signal,
      },
    );
    raw = result.data;
  } catch (e) {
    // The raw diff endpoint 406es for PRs beyond GitHub's diff budget. Mark
    // the un-patched files rather than failing the whole file list.
    if (e instanceof GitHubError) {
      markMissingAsTooLarge(files);
      return;
    }
    throw e;
  }
  if (raw.length > MAX_RAW_DIFF_BYTES) {
    markMissingAsTooLarge(files);
    return;
  }
  const byPath = splitRawDiff(raw);
  for (const file of files) {
    if (file.patch !== undefined || file.isBinary) continue;
    const section = byPath.get(file.path);
    if (section) {
      // Strip the headers back off: FileChange.patch carries hunks only, the
      // same shape the files API returns (buildFilePatch re-adds headers).
      const hunkStart = section.indexOf("\n@@");
      file.patch = hunkStart === -1 ? undefined : section.slice(hunkStart + 1);
    }
    if (file.patch === undefined) file.tooLarge = true;
  }
}

function markMissingAsTooLarge(files: FileChange[]): void {
  for (const file of files) {
    if (file.patch === undefined && !file.isBinary) file.tooLarge = true;
  }
}

// The one GitHub "file at a commit" read. The RAW media type is the point: the
// JSON contents encoding tops out at 1MB, and the diff pane's context expansion
// cannot take a truncated file — every line below the cut would render wrong.
const MAX_BLOB_BYTES = 2_000_000;

/**
 * One file's text at a commit. Null when it does not exist there, is too large,
 * or isn't text.
 */
export async function fetchFileAtRef(
  cfg: Config,
  ref: PrRef,
  path: string,
  sha: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Path traversal is meaningless against the contents API (it resolves inside
  // the repo tree), but a leading slash or `..` just 404s — reject early.
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  try {
    const { data, response } = await rest<string>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/contents/${encoded}?ref=${encodeURIComponent(sha)}`,
      {
        accept: "application/vnd.github.raw",
        maxBytes: MAX_BLOB_BYTES,
        signal,
      },
    );
    // A directory (or a submodule) comes back as JSON however we ask.
    if ((response.headers.get("content-type") ?? "").includes("json"))
      return null;
    return typeof data === "string" ? data : null;
  } catch (e) {
    // 413 is our own size refusal; 403 is a blocked/oversized blob.
    if (
      e instanceof GitHubError &&
      (e.status === 404 || e.status === 403 || e.status === 413)
    )
      return null;
    throw e;
  }
}
