// What the pipeline may put in front of the model beyond the diff, and how
// much of it. Pure, so the budgets and the path hygiene are testable without a
// GitHub round trip; the fetching lives in server/agent/pipeline/context.ts.
//
// Every rule here exists because the model sees HUNKS by default, and most of
// the comments worth leaving depend on code the hunk does not show — the
// caller of a changed signature, the type a field was added to, the test that
// should have moved with it.

/** The repo's own instructions to agents, read in this order. `.tandem/` wins
 * because it is written for THIS tool; the rest are what a repo already has —
 * almost nobody writes a `.tandem/conventions.md`, most have a CLAUDE.md. */
export const REPO_GUIDANCE_FILES = [
  ".tandem/conventions.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
] as const;

export type ContextFile = { path: string; text: string };

/**
 * The guidance files that exist, joined under their own headings and capped
 * as a whole. Each file keeps its OWN name in the prompt, so the model can
 * tell a repo-wide rule from a tool-specific one. Null when there are none.
 */
export function joinGuidance(
  found: ReadonlyArray<ContextFile | null>,
  maxChars: number,
): string | null {
  const parts: string[] = [];
  let used = 0;
  for (const file of found) {
    if (!file || !file.text.trim()) continue;
    const room = maxChars - used;
    if (room <= 200) break;
    const body =
      file.text.length > room
        ? `${file.text.slice(0, room)}\n… (truncated)`
        : file.text;
    parts.push(`#### ${file.path}\n${body.trimEnd()}`);
    used += body.length;
  }
  return parts.length ? parts.join("\n\n") : null;
}

export type Budget = { perFile: number; total: number };

/**
 * Fit files into a character budget IN ORDER: each is truncated to `perFile`,
 * and once the total is spent the rest are listed as omitted rather than
 * silently dropped — the prompt says which files it could not include, so the
 * model does not mistake "not shown" for "does not exist".
 */
export function budgetFiles(
  files: readonly ContextFile[],
  budget: Budget,
): { included: ContextFile[]; omitted: string[] } {
  const included: ContextFile[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const file of files) {
    const text =
      file.text.length > budget.perFile
        ? `${file.text.slice(0, budget.perFile)}\n… (truncated at ${budget.perFile} characters)`
        : file.text;
    if (used + text.length > budget.total) {
      omitted.push(file.path);
      continue;
    }
    included.push({ path: file.path, text });
    used += text.length;
  }
  return { included, omitted };
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * Paths near the change that pass 1 may ask to have read in full: everything
 * in a changed file's own directory, then its parent's, and so on, nearest
 * first, never a changed file itself. Nearest-first is the point — a sibling
 * `foo.test.ts` or `types.ts` is far likelier to matter than a file three
 * levels up, and the cap cuts from the far end.
 */
export function neighbourhoodPaths(
  tree: readonly string[],
  changed: readonly string[],
  cap: number,
): string[] {
  const changedSet = new Set(changed);
  const byDir = new Map<string, string[]>();
  for (const path of tree) {
    if (changedSet.has(path)) continue;
    const dir = dirOf(path);
    const list = byDir.get(dir);
    if (list) list.push(path);
    else byDir.set(dir, [path]);
  }
  // Rings of directories, one level further out per round.
  const rings: string[][] = [];
  for (const path of changed) {
    let dir = dirOf(path);
    for (let depth = 0; depth < 3; depth++) {
      (rings[depth] ??= []).push(dir);
      if (dir === "") break;
      dir = dirOf(dir);
    }
  }
  const out: string[] = [];
  const seenDir = new Set<string>();
  for (const ring of rings) {
    for (const dir of ring) {
      if (seenDir.has(dir)) continue;
      seenDir.add(dir);
      for (const path of (byDir.get(dir) ?? []).toSorted()) {
        if (out.length >= cap) return out;
        out.push(path);
      }
    }
  }
  return out;
}

/**
 * The files pass 1 asked for, filtered to what can honestly be read: paths
 * that exist in the tree, are not already in the diff (those are read in full
 * anyway), deduped, capped. The model never gets to name something outside
 * the repo — a path it made up simply is not in `tree`.
 */
export function pickContextPaths(
  requested: readonly string[] | undefined,
  tree: ReadonlySet<string>,
  changed: ReadonlySet<string>,
  max: number,
): string[] {
  const out: string[] = [];
  for (const raw of requested ?? []) {
    const path = raw.trim().replace(/^\.\//, "");
    if (!tree.has(path) || changed.has(path) || out.includes(path)) continue;
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A tool call's path, relative to the checkout it ran in — for the run log
 * and chat's "reading X". Null for anything outside `root` (the CLI confines
 * the tools there, so that would be a refused call, not a read).
 */
export function relativeToRoot(root: string, path: string): string | null {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  const base = norm(root);
  const full = norm(path);
  if (!full.startsWith("/") && !/^[A-Za-z]:\//.test(full))
    return full.replace(/^\.\//, "") || null;
  if (full === base) return null;
  return full.startsWith(`${base}/`) ? full.slice(base.length + 1) : null;
}

/** What a checkout tool call is looking at, repo-relative: Read's file, or the
 * directory a Grep/Glob was scoped to. Null for a repo-wide search. */
export function toolTargetOf(
  input: Record<string, unknown>,
  root: string,
): string | null {
  const raw = input.file_path ?? input.path;
  return typeof raw === "string" ? relativeToRoot(root, raw) : null;
}
