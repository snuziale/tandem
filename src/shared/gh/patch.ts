// Patch assembly for @pierre/diffs. The REST files API returns bare hunks in
// `patch` (no `diff --git` / `---` / `+++` headers), and parsePatchFiles needs
// headers to identify the file and change type — buildFilePatch adds them.
// splitRawDiff handles the fallback path: the whole-PR unified diff fetched
// with `Accept: application/vnd.github.diff` (used when the files API omits
// patches or the PR exceeds its 300-file window), split back per file.
import type { FileChange } from "../review-types";

/** A complete single-file unified patch, or null when there is nothing to
 * render (binary or patch withheld by the API). */
export function buildFilePatch(f: FileChange): string | null {
  if (f.patch === undefined) return null;
  const oldPath = f.previousPath ?? f.path;
  const lines = [`diff --git a/${oldPath} b/${f.path}`];
  if (f.status === "renamed") {
    lines.push(`rename from ${oldPath}`, `rename to ${f.path}`);
  }
  if (f.status === "added") {
    lines.push("new file mode 100644", "--- /dev/null", `+++ b/${f.path}`);
  } else if (f.status === "removed") {
    lines.push("deleted file mode 100644", `--- a/${oldPath}`, "+++ /dev/null");
  } else {
    lines.push(`--- a/${oldPath}`, `+++ b/${f.path}`);
  }
  lines.push(f.patch);
  return `${lines.join("\n")}\n`;
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
    if (!section.startsWith("diff --git ")) continue;
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
export function countDiffLines(
  files: Array<Pick<FileChange, "additions" | "deletions">>,
): number {
  return files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
}

export type DiffLineIndex = {
  /** Old-file line numbers present in the patch (deletions + context). */
  left: Set<number>;
  /** New-file line numbers present in the patch (additions + context). */
  right: Set<number>;
};

/**
 * Which line numbers a comment/finding can anchor to on each side of this
 * file's patch. Used to reject model output citing lines outside the diff and
 * to detect moved anchors after new commits.
 */
export function diffLineIndex(patch: string): DiffLineIndex {
  const left = new Set<number>();
  const right = new Set<number>();
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("-")) {
      left.add(oldLine++);
    } else if (line.startsWith("+")) {
      right.add(newLine++);
    } else if (line.startsWith(" ") || line === "") {
      left.add(oldLine++);
      right.add(newLine++);
    }
  }
  return { left, right };
}

/** Line numbers something is anchored to (threads, staged comments, findings,
 * the composer). Folding one away would take its card with it. */
export type KeepLines = {
  left: ReadonlySet<number>;
  right: ReadonlySet<number>;
};

const NO_KEEP: KeepLines = { left: new Set(), right: new Set() };

type BodyLine = {
  kind: "ctx" | "del" | "add";
  /** The raw patch line, prefix included. */
  text: string;
  oldNo: number;
  newNo: number;
  /** The "\ No newline at end of file" marker following this line, if any. */
  noEol?: string;
};

const withoutWhitespace = (line: string) => line.slice(1).replace(/\s+/g, "");

/**
 * `git diff -w` for one file's patch: a deletion and an addition differing
 * only in whitespace collapse into ONE context line, and a hunk left with no
 * real change is dropped (all of them, and only the headers come back).
 *
 * Line numbering is preserved exactly — the pair consumed one old and one new
 * line and so does its context line, so the `@@` counts never move. Everything
 * downstream (annotations, line clicks, `scrollTo`) addresses lines by number.
 */
export function hideWhitespaceChanges(
  patch: string,
  keep: KeepLines = NO_KEEP,
): string {
  const lines = patch.split("\n");
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!header) {
      out.push(lines[i++]);
      continue;
    }
    const headerLine = lines[i++];
    let oldNo = Number(header[1]);
    let newNo = Number(header[3]);
    const body: BodyLine[] = [];
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) break;
      if (line.startsWith("\\")) {
        // Belongs to the line above, and dies with it.
        const last = body[body.length - 1];
        if (last) last.noEol = line;
        continue;
      }
      if (line.startsWith("-"))
        body.push({ kind: "del", text: line, oldNo: oldNo++, newNo });
      else if (line.startsWith("+"))
        body.push({ kind: "add", text: line, oldNo, newNo: newNo++ });
      else if (line.startsWith(" ") || line === "")
        body.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
      else break; // not a hunk body line — leave it to the outer loop
    }
    const folded = foldHunkBody(body, keep);
    const keepsAnchor = body.some(
      (l) =>
        (l.kind !== "add" && keep.left.has(l.oldNo)) ||
        (l.kind !== "del" && keep.right.has(l.newNo)),
    );
    // Nothing left changed: `-w` drops the hunk, unless a card sits in it.
    if (!folded.some((l) => l.kind !== "ctx") && !keepsAnchor) continue;
    out.push(headerLine);
    for (const line of folded) {
      out.push(line.text);
      if (line.noEol) out.push(line.noEol);
    }
  }
  return out.join("\n") + (trailingNewline ? "\n" : "");
}

function foldHunkBody(body: BodyLine[], keep: KeepLines): BodyLine[] {
  const out: BodyLine[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i].kind === "ctx") {
      out.push(body[i++]);
      continue;
    }
    const start = i;
    while (i < body.length && body[i].kind !== "ctx") i++;
    const run = body.slice(start, i);
    const dels = run.filter((l) => l.kind === "del");
    const adds = run.filter((l) => l.kind === "add");
    const pairs = whitespaceOnlyPairs(dels, adds, keep);
    if (pairs.length === 0) {
      out.push(...run);
      continue;
    }
    // Unmatched deletions, then unmatched additions, then the context line
    // standing in for the pair: the one order that keeps both line counters
    // monotone, so the context line lands on the numbers the pair occupied.
    let d = 0;
    let a = 0;
    for (const [di, ai] of pairs) {
      for (; d < di; d++) out.push(dels[d]);
      for (; a < ai; a++) out.push(adds[a]);
      out.push({
        kind: "ctx",
        text: ` ${adds[ai].text.slice(1)}`, // the post-change text
        oldNo: dels[di].oldNo,
        newNo: adds[ai].newNo,
      });
      d = di + 1;
      a = ai + 1;
    }
    for (; d < dels.length; d++) out.push(dels[d]);
    for (; a < adds.length; a++) out.push(adds[a]);
  }
  return out;
}

/** Which deletions pair with which additions, in order: an LCS over the
 * whitespace-stripped text. Anchored lines never pair. */
function whitespaceOnlyPairs(
  dels: BodyLine[],
  adds: BodyLine[],
  keep: KeepLines,
): Array<[number, number]> {
  if (dels.length === 0 || adds.length === 0) return [];
  // A reindented file is one giant run and the DP is O(n·m) — show the raw
  // diff rather than freeze the pane.
  if (dels.length * adds.length > 250_000) return [];
  const dk = dels.map((l) =>
    keep.left.has(l.oldNo) ? null : withoutWhitespace(l.text),
  );
  const ak = adds.map((l) =>
    keep.right.has(l.newNo) ? null : withoutWhitespace(l.text),
  );
  const w = adds.length + 1;
  const dp = new Uint32Array((dels.length + 1) * w);
  for (let x = dels.length - 1; x >= 0; x--) {
    for (let y = adds.length - 1; y >= 0; y--) {
      dp[x * w + y] =
        dk[x] !== null && dk[x] === ak[y]
          ? dp[(x + 1) * w + y + 1] + 1
          : Math.max(dp[(x + 1) * w + y], dp[x * w + y + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  while (x < dels.length && y < adds.length) {
    if (dk[x] !== null && dk[x] === ak[y]) {
      pairs.push([x, y]);
      x++;
      y++;
    } else if (dp[(x + 1) * w + y] >= dp[x * w + y + 1]) x++;
    else y++;
  }
  return pairs;
}

/** Whether a patch has anything left to render. */
export function hasHunks(patch: string): boolean {
  return /^@@ /m.test(patch);
}
