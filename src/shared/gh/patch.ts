// Patch assembly for @pierre/diffs. The REST files API returns bare hunks in
// `patch` (no `diff --git` / `---` / `+++` headers), and parsePatchFiles needs
// headers to identify the file and change type — buildFilePatch adds them.
// splitRawDiff handles the fallback path: the whole-PR unified diff fetched
// with `Accept: application/vnd.github.diff` (used when the files API omits
// patches or the PR exceeds its 300-file window), split back per file.
import type { FileChange } from '../review-types';

/** A complete single-file unified patch, or null when there is nothing to
 * render (binary or patch withheld by the API). */
export function buildFilePatch(f: FileChange): string | null {
  if (f.patch === undefined) return null;
  const oldPath = f.previousPath ?? f.path;
  const lines = [`diff --git a/${oldPath} b/${f.path}`];
  if (f.status === 'renamed') {
    lines.push(`rename from ${oldPath}`, `rename to ${f.path}`);
  }
  if (f.status === 'added') {
    lines.push('new file mode 100644', '--- /dev/null', `+++ b/${f.path}`);
  } else if (f.status === 'removed') {
    lines.push('deleted file mode 100644', `--- a/${oldPath}`, '+++ /dev/null');
  } else {
    lines.push(`--- a/${oldPath}`, `+++ b/${f.path}`);
  }
  lines.push(f.patch);
  return `${lines.join('\n')}\n`;
}

/**
 * Split a whole-PR unified diff into per-file patch strings keyed by the NEW
 * path (old path for deletions) — the same key FileChange.path uses.
 */
export function splitRawDiff(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  // Split on `diff --git` at line starts; the first chunk is preamble (empty
  // for GitHub's .diff output).
  const sections = raw.split(/^(?=diff --git )/m);
  for (const section of sections) {
    if (!section.startsWith('diff --git ')) continue;
    const path = pathOfSection(section);
    if (path) out.set(path, section);
  }
  return out;
}

function pathOfSection(section: string): string | null {
  // Prefer the +++ target; deletions have +++ /dev/null so fall back to ---.
  const plus = /^\+\+\+ b\/(.+)$/m.exec(section);
  if (plus) return plus[1];
  const minus = /^--- a\/(.+)$/m.exec(section);
  if (minus) return minus[1];
  // Quoted or exotic paths: parse the `diff --git a/x b/y` line itself.
  const header = /^diff --git a\/(.+) b\/(.+)$/m.exec(section);
  return header ? header[2] : null;
}

/** Total changed-line count of a diff (additions + deletions), for size caps. */
export function countDiffLines(files: Array<Pick<FileChange, 'additions' | 'deletions'>>): number {
  return files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
}
