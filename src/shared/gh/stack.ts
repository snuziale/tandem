// A stack of PRs reviewed as ONE combined diff (bottom base → top head), with
// every comment still owned by exactly one PR. SPIKE: the combined view is a
// projection — comments are stored in the owning PR's own draft, in that PR's
// coordinates, and translated to/from the combined diff here.
//
// Line numbers move between layers only through the hunks of the PRs in
// between, so every translation is a walk over those patches. Renames are not
// followed (path identity only).
import type { DiffSide, FileChange, PrId } from "../review-types";
import { clampCommentRange, diffLineIndex, patchBodyLines } from "./patch";

export type StackPr = {
  prId: PrId;
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  headSha: string;
};

/** Bottom → top. `combined` is the whole stack's diff; empty for a lone PR.
 * `unrebased`: PR numbers not on top of the PR below — line ownership cannot
 * be computed across them, so the combined view is refused. */
export type PrStack = {
  prs: StackPr[];
  combined: FileChange[];
  unrebased: number[];
};

/** Each layer's files, bottom → top, parallel to `PrStack.prs`. */
export type StackLayers = ReadonlyArray<readonly FileChange[]>;

export type Owned = { layer: number; line: number };

/**
 * Which PR owns a line of the combined diff, and where that line sits in the
 * owner's own diff. RIGHT: the highest layer that ADDED it (a later edit makes
 * the later PR the owner). LEFT: the lowest layer that DELETED it. A line that
 * is context everywhere falls back to the first layer whose patch shows it.
 * Null when no layer can take a comment there.
 */
export function ownerOf(
  layers: StackLayers,
  path: string,
  side: DiffSide,
  line: number,
): Owned | null {
  const order =
    side === "RIGHT"
      ? layers.map((_, i) => layers.length - 1 - i)
      : layers.map((_, i) => i);
  const from = side === "RIGHT" ? "new" : "old";
  let n = line;
  let fallback: Owned | null = null;
  for (const layer of order) {
    const file = layers[layer].find((f) => f.path === path);
    if (!file) continue; // untouched here: line numbers pass straight through
    if (file.patch === undefined) return null;
    const t = translate(file.patch, from, n);
    if (t.changed) return { layer, line: n };
    if (t.inPatch && !fallback) fallback = { layer, line: n };
    if (t.line === null) return fallback;
    n = t.line;
  }
  return fallback;
}

/**
 * The inverse: a comment stored on `layer` in that PR's coordinates, moved to
 * the combined diff. Null when a later (RIGHT) or earlier (LEFT) layer changed
 * the line, so it has no place in the combined view.
 */
export function toCombined(
  layers: StackLayers,
  layer: number,
  path: string,
  side: DiffSide,
  line: number,
): number | null {
  // RIGHT lives at the layer's head → walk UP through later layers (old→new).
  // LEFT lives at the layer's base → walk DOWN through earlier ones (new→old).
  const others =
    side === "RIGHT"
      ? layers.slice(layer + 1)
      : layers.slice(0, layer).reverse();
  const from = side === "RIGHT" ? "old" : "new";
  let n = line;
  for (const files of others) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;
    if (file.patch === undefined) return null;
    const t = translate(file.patch, from, n);
    if (t.changed || t.line === null) return null;
    n = t.line;
  }
  return n;
}

/**
 * A combined-diff selection → one comment on one PR. A range whose two ends
 * have different owners collapses to its anchor; the range is then clamped
 * against the owner's own patch, as a dragged selection is.
 */
export function routeComment(
  layers: StackLayers,
  path: string,
  side: DiffSide,
  line: number,
  startLine: number | undefined,
): { layer: number; line: number; startLine?: number } | null {
  const end = ownerOf(layers, path, side, line);
  if (!end) return null;
  const start =
    startLine !== undefined ? ownerOf(layers, path, side, startLine) : null;
  if (!start || start.layer !== end.layer || start.line >= end.line)
    return { layer: end.layer, line: end.line };
  const patch = layers[end.layer].find((f) => f.path === path)?.patch;
  const clamped = patch
    ? clampCommentRange(diffLineIndex(patch), side, start.line, end.line)
    : null;
  return clamped && clamped.start < clamped.end
    ? { layer: end.layer, line: clamped.end, startLine: clamped.start }
    : { layer: end.layer, line: end.line };
}

/** One PR's edit to a block of lines: what it replaced and what it wrote. */
export type Touch = { layer: number; before: string[]; after: string[] };

/** A block of the combined diff that more than one PR wrote, anchored at its
 * last line (RIGHT side). `touches` is bottom → top. */
export type HistoryMark = { line: number; touches: Touch[] };

/**
 * Every combined-diff block that two or more layers edited in turn — e.g.
 * #4243 added a line and #4245 rewrote it. Consecutive added lines with the
 * same chain of layers form one block.
 */
export function historyMarks(
  layers: StackLayers,
  combined: FileChange,
): HistoryMark[] {
  if (!combined.patch) return [];
  const marks: HistoryMark[] = [];
  let prev: { line: number; key: string } | null = null;
  for (const l of patchBodyLines(combined.patch)) {
    if (l.kind !== "add") {
      prev = null;
      continue;
    }
    const touches = lineHistory(layers, combined.path, l.newNo);
    if (touches.length < 2) {
      prev = null;
      continue;
    }
    const key = touches.map((t) => t.layer).join(",");
    const last = marks[marks.length - 1];
    // Same chain as the line above: extend that block downward.
    if (prev && last && prev.key === key && prev.line === l.newNo - 1) {
      last.line = l.newNo;
      last.touches = touches;
    } else marks.push({ line: l.newNo, touches });
    prev = { line: l.newNo, key };
  }
  return marks;
}

/**
 * The chain of layers that edited one combined RIGHT line, bottom → top: the
 * layer that wrote it, then — through the lines that edit REPLACED — whichever
 * lower layer had written those, and so on down.
 */
export function lineHistory(
  layers: StackLayers,
  path: string,
  line: number,
): Touch[] {
  const out: Touch[] = [];
  let at = addedBy(layers, path, line);
  while (at) {
    const patch = layers[at.layer].find((f) => f.path === path)?.patch;
    if (!patch) break;
    const block = changeBlock(patch, at.line);
    out.unshift({
      layer: at.layer,
      before: block.filter((b) => b.kind === "del").map((b) => b.text),
      after: block.filter((b) => b.kind === "add").map((b) => b.text),
    });
    const below = layers.slice(0, at.layer);
    let next: Owned | null = null;
    for (const d of block)
      if (d.kind === "del") next ??= addedBy(below, path, d.oldNo);
    at = next;
  }
  return out;
}

/** Like `ownerOf` on the RIGHT, but only a layer that actually ADDED the line. */
function addedBy(
  layers: StackLayers,
  path: string,
  line: number,
): Owned | null {
  let n = line;
  for (let layer = layers.length - 1; layer >= 0; layer--) {
    const file = layers[layer].find((f) => f.path === path);
    if (!file) continue;
    if (file.patch === undefined) return null;
    const t = translate(file.patch, "new", n);
    if (t.changed) return { layer, line: n };
    if (t.line === null) return null;
    n = t.line;
  }
  return null;
}

/** The contiguous run of -/+ lines around the addition at new line `n`. */
function changeBlock(patch: string, n: number) {
  const lines = patchBodyLines(patch);
  const i = lines.findIndex((l) => l.kind === "add" && l.newNo === n);
  if (i === -1) return [];
  let a = i;
  let b = i;
  while (a > 0 && lines[a - 1].kind !== "ctx") a--;
  while (b < lines.length - 1 && lines[b + 1].kind !== "ctx") b++;
  return lines.slice(a, b + 1);
}

/**
 * Move one line number across ONE patch. `from: "new"` maps a line of the
 * patch's new side to its old side (null + changed when the patch added it);
 * `from: "old"` the reverse. `inPatch` = it is a context line inside a hunk.
 */
export function translate(
  patch: string,
  from: "old" | "new",
  n: number,
): { line: number | null; changed: boolean; inPatch: boolean } {
  const fromNew = from === "new";
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      // A zero-length side's start names the line BEFORE the hunk.
      const oldStart = Number(hunk[1]) + (hunk[2] === "0" ? 1 : 0);
      const newStart = Number(hunk[3]) + (hunk[4] === "0" ? 1 : 0);
      const start = fromNew ? newStart : oldStart;
      // In the gap before this hunk the two sides move in lockstep.
      if (n < start) {
        const offset = fromNew ? oldStart - newStart : newStart - oldStart;
        return { line: n + offset, changed: false, inPatch: false };
      }
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      if (fromNew && newLine === n)
        return { line: null, changed: true, inPatch: true };
      newLine++;
    } else if (raw.startsWith("-")) {
      if (!fromNew && oldLine === n)
        return { line: null, changed: true, inPatch: true };
      oldLine++;
    } else if (raw.startsWith(" ") || raw === "") {
      if ((fromNew ? newLine : oldLine) === n)
        return {
          line: fromNew ? oldLine : newLine,
          changed: false,
          inPatch: true,
        };
      oldLine++;
      newLine++;
    }
  }
  // Past the last hunk: the counters' difference is the offset.
  const offset = fromNew ? oldLine - newLine : newLine - oldLine;
  return { line: n + offset, changed: false, inPatch: false };
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
