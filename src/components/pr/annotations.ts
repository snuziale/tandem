// The metadata type carried by every @pierre/diffs annotation Tandem renders
// inline in the diff. One union across milestones: human threads, the line
// composer, and agent findings all land as diff-line annotations.
import type { MouseEvent } from "react";
import type {
  DiffLineAnnotation,
  LineTypes,
  SelectedLineRange,
} from "@pierre/diffs";
import {
  clampCommentRange,
  type DiffLineIndex,
  type KeepLines,
} from "../../shared/gh/patch";
import type { PendingComment, ReviewThread } from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import type { Finding } from "../../shared/agent-types";
import type { ComposerTarget } from "../../state/uiStore";

export type TandemAnno =
  | { kind: "thread"; thread: ReviewThread }
  | { kind: "composer"; target: ComposerTarget }
  | { kind: "pending"; comment: PendingComment }
  | { kind: "finding"; finding: Finding };

/** GitHub side → @pierre/diffs annotation side. */
export function annotationSideOf(
  side: "LEFT" | "RIGHT",
): "deletions" | "additions" {
  return side === "LEFT" ? "deletions" : "additions";
}

export function diffSideOf(side: "deletions" | "additions"): "LEFT" | "RIGHT" {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

/**
 * The one convention every anchored thing in this pane shares: the card hangs
 * at the END line, and `startLine` is absent when there is only one. Written
 * once here, read by both directions — `spanOf` to expand a stored anchor,
 * `startLineOf` to collapse a computed range back before storing it.
 */
export function spanOf(
  startLine: number | undefined,
  end: number,
): { start: number; end: number } {
  return { start: Math.min(startLine ?? end, end), end };
}

export function startLineOf(start: number, end: number): number | undefined {
  return start === end ? undefined : start;
}

/**
 * The line span an annotation covers on its own side. Everything inline here
 * can be a RANGE — a thread, a staged comment and a finding all carry an
 * optional `startLine`, and the composer does too — but every one of them
 * anchors its card at the END line, which is the annotation's `lineNumber`.
 *
 * Two things read this: the fold map (a range must stay unfolded for its whole
 * height, or a card outlives half of what it points at) and the item version
 * hash (extend a range and the item has to re-render with the new metadata).
 */
export function annoSpan(anno: DiffLineAnnotation<TandemAnno>): {
  start: number;
  end: number;
} {
  const meta = anno.metadata;
  const start =
    meta.kind === "thread"
      ? meta.thread.startLine
      : meta.kind === "pending"
        ? meta.comment.startLine
        : meta.kind === "finding"
          ? meta.finding.startLine
          : meta.target.startLine;
  return spanOf(start, anno.lineNumber);
}

/**
 * Every line number something is anchored to, by path — what the
 * hide-whitespace rewrite must not fold away, because folding a line takes its
 * card with it and a RANGE card would end up pointing at half its own
 * evidence.
 *
 * Written off the SOURCES rather than off built annotations so there is one
 * spelling of it for two readers: the pane, which folds the patch it renders,
 * and find-in-diff, which has to rebuild that same patch to scan the text
 * actually on screen. A thread with a null `line` is outdated against this
 * diff and anchors nothing.
 */
export function keepLinesByPath(sources: {
  threads: readonly ReviewThread[];
  pendingComments: readonly PendingComment[];
  findings: readonly Finding[];
  composerTarget: ComposerTarget | null;
}): Map<string, KeepLines> {
  const map = new Map<string, { left: Set<number>; right: Set<number> }>();
  const keep = (
    path: string,
    side: "LEFT" | "RIGHT",
    startLine: number | undefined,
    end: number,
  ) => {
    let entry = map.get(path);
    if (!entry) {
      entry = { left: new Set(), right: new Set() };
      map.set(path, entry);
    }
    const set = side === "LEFT" ? entry.left : entry.right;
    const span = spanOf(startLine, end);
    for (let n = span.start; n <= span.end; n++) set.add(n);
  };
  for (const thread of sources.threads)
    if (thread.line !== null)
      keep(thread.path, thread.side, thread.startLine, thread.line);
  for (const comment of sources.pendingComments)
    keep(comment.path, comment.side, comment.startLine, comment.line);
  for (const finding of sources.findings)
    keep(finding.path, finding.side, finding.startLine, finding.endLine);
  const composer = sources.composerTarget;
  if (composer)
    keep(composer.path, composer.side, composer.startLine, composer.line);
  return map;
}

/**
 * A committed library selection, translated into the app's comment anchor and
 * clamped to what GitHub accepts. This is the pane's least obvious rule and
 * the reason it lives here rather than in the component: a split-view drag
 * that CROSSED sides is not one comment — GitHub has no anchor for "old 12
 * through new 40" — so it degrades to the single line the pointer ended on
 * rather than inventing one.
 *
 * Null when the anchor is not commentable, matching `isCommentableLine` on a
 * plain line click: the caller opens no composer at all.
 */
export function commentAnchorOf(
  range: SelectedLineRange,
  index: DiffLineIndex,
): { line: number; startLine?: number; side: "LEFT" | "RIGHT" } | null {
  const startSide = range.side ?? "additions";
  const endSide = range.endSide ?? startSide;
  const crossed = startSide !== endSide;
  const side = diffSideOf(endSide);
  const first = crossed ? range.end : Math.min(range.start, range.end);
  const last = crossed ? range.end : Math.max(range.start, range.end);
  const clamped = clampCommentRange(index, side, first, last);
  if (!clamped) return null;
  return {
    line: clamped.end,
    startLine: startLineOf(clamped.start, clamped.end),
    side,
  };
}

/**
 * Click-to-focus for an inline card that is not a finding — a staged comment
 * or a human thread. Focusing it lends it the pane's ONE line selection, which
 * is the only way a card that spans lines shows how far it reaches; clicking
 * the focused one again gives the selection back.
 *
 * The toggle ignores clicks that landed on a control (edit, remove, a link),
 * because those already mean something else and un-highlighting under them
 * reads as the button misfiring.
 */
export function focusCardProps(id: string, focused: boolean) {
  return {
    onClick: (e: MouseEvent) => {
      const control =
        e.target instanceof Element &&
        e.target.closest("button, a, input, textarea, [role='button']");
      if (focused && control) return; // the control owns this click
      useUiStore.getState().setFocusedComment(focused ? null : id);
    },
  };
}

/**
 * Whether a clicked line can carry a review comment. Expanded context is real
 * file content the patch never named, so GitHub's review API rejects a comment
 * there — staged, it would survive triage and die with a per-comment 422 at
 * submit. `diffLineIndex` answers the same question from the patch; this reads
 * it off the row the library already classified. A dragged RANGE is checked
 * the other way, against the patch (`clampCommentRange`), because the library
 * hands back line numbers rather than rows.
 */
export function isCommentableLine(lineType: LineTypes): boolean {
  return lineType !== "context-expanded";
}
