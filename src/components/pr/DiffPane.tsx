import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  parsePatchFiles,
  type CodeViewLineSelection,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewReactOptions,
  type DiffLineAnnotation,
} from "@pierre/diffs/react";
import { useQueryClient } from "@tanstack/react-query";
import type { Finding } from "../../shared/agent-types";
import {
  clampCommentRange,
  diffLineIndex,
  hasHunks,
  patchLineText,
  renderedPatch,
  type DiffLineIndex,
  type KeepLines,
} from "../../shared/gh/patch";
import type {
  DiffSide,
  FileChange,
  PendingComment,
  PrId,
  ReviewThread,
} from "../../shared/review-types";
import { resolveTheme, useThemeStore } from "../../state/themeStore";
import { useUiStore, type ComposerTarget } from "../../state/uiStore";
import { FindingCard } from "../agent/FindingCard";
import {
  annoSpan,
  annotationSideOf,
  commentAnchorOf,
  diffSideOf,
  isCommentableLine,
  keepLinesByPath,
  spanOf,
  startLineOf,
  type TandemAnno,
} from "./annotations";
import type { DiffHit } from "./diffSearch";
import { DiffFileHeader } from "./DiffFileHeader";
import { loadDiffFileSides } from "./expandContext";
import { ComposerCard } from "./ComposerCard";
import { PendingCard } from "./PendingCard";
import { ThreadCard } from "./ThreadCard";

export type DiffPaneHandle = CodeViewHandle<TandemAnno>;

type Props = {
  prId: PrId;
  headSha: string;
  files: FileChange[];
  threads: ReviewThread[];
  pendingComments: PendingComment[];
  /** Agent findings still in triage (proposed/edited) — rendered inline. */
  findings: Finding[];
  /** Paths the reviewer has marked viewed — each file header toggles its own. */
  viewedFiles: string[];
  onToggleViewed: (path: string) => void;
  /** Folded files: header only, no code. Derived upstream from viewed + the
   * reader's own chevron overrides, so the tree/findings can expand a file. */
  collapsedPaths: Set<string>;
  onToggleCollapsed: (path: string) => void;
  /** Path click in a file header: sync the tree, don't re-scroll the diff. */
  onSelectPath: (path: string) => void;
  onAddComment: (comment: Omit<PendingComment, "localId">) => void;
  onUpdateComment: (localId: string, patch: Partial<PendingComment>) => void;
  onRemoveComment: (localId: string) => void;
  /** The find-in-diff hit the reader is on, if any. It borrows the pane's ONE
   * line selection while the find bar is open — see the selection memo. */
  searchHit: DiffHit | null;
  /** React writes this; the pane reads it too — it owns the diff's line
   * selection while PrDetailView owns scrollTo. One ref, two readers. */
  codeViewRef: React.RefObject<DiffPaneHandle | null>;
};

const EMPTY_ANNOS: DiffLineAnnotation<TandemAnno>[] = [];
/** Module constant so the keep map keeps ONE identity while hide-whitespace is
 * off — that is what holds the parsed diffs (and the reader's expansions)
 * still across annotation changes. See the keepByPath memo. */
const NO_KEEP_BY_PATH: ReadonlyMap<string, KeepLines> = new Map();

// GitHub's own step. The library defaults to 100, which overshoots what a
// reviewer wants when they are peeking just above a hunk.
const EXPANSION_LINE_COUNT = 20;

// Controlled CodeView items re-render only on version changes. Annotation
// CONTENT is a React render prop and updates through React regardless — the
// version only has to change when the diff (headSha) or annotation POSITIONS
// or COUNT change, so a pure hash of exactly those inputs is enough.
// `collapsed` and `hideWhitespace` are in the hash for the same reason: the
// library only reads them off a re-rendered item.
function versionOf(
  headSha: string,
  annotations: DiffLineAnnotation<TandemAnno>[],
  collapsed: boolean,
  hideWhitespace: boolean,
): number {
  let h = (collapsed ? 1 : 0) + (hideWhitespace ? 2 : 0);
  for (let i = 0; i < headSha.length; i++)
    h = (h * 31 + headSha.charCodeAt(i)) | 0;
  for (const a of annotations) {
    h = (h * 31 + a.lineNumber * 2 + (a.side === "additions" ? 1 : 0)) | 0;
    // The SPAN is part of the position: extending a range moves nothing the
    // library laid out, but the card has to re-render with the new metadata,
    // and the library only hands the render prop the annotation it is holding.
    h = (h * 31 + annoSpan(a).start) | 0;
  }
  return ((h | 0) >>> 0) + annotations.length;
}

export function DiffPane({
  prId,
  headSha,
  files,
  threads,
  pendingComments,
  findings,
  viewedFiles,
  onToggleViewed,
  collapsedPaths,
  onToggleCollapsed,
  onSelectPath,
  onAddComment,
  onUpdateComment,
  onRemoveComment,
  searchHit,
  codeViewRef,
}: Props) {
  const diffStyle = useUiStore((s) => s.diffStyle);
  const hideWhitespace = useUiStore((s) => s.hideWhitespace);
  const themePreference = useThemeStore((s) => s.preference);
  const composerTarget = useUiStore((s) => s.composerTarget);
  const setComposerTarget = useUiStore((s) => s.setComposerTarget);

  const fileByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const viewedPaths = useMemo(() => new Set(viewedFiles), [viewedFiles]);
  const findingPaths = useMemo(
    () => new Set(findings.map((f) => f.path)),
    [findings],
  );

  const annotationsByPath = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<TandemAnno>[]>();
    const push = (path: string, anno: DiffLineAnnotation<TandemAnno>) => {
      const list = map.get(path) ?? [];
      list.push(anno);
      map.set(path, list);
    };
    for (const thread of threads) {
      // Outdated threads have no line against the current diff — the header
      // count still includes them; inline they would misanchor.
      if (thread.line === null) continue;
      push(thread.path, {
        side: annotationSideOf(thread.side),
        lineNumber: thread.line,
        metadata: { kind: "thread", thread },
      });
    }
    for (const comment of pendingComments) {
      push(comment.path, {
        side: annotationSideOf(comment.side),
        lineNumber: comment.line,
        metadata: { kind: "pending", comment },
      });
    }
    for (const finding of findings) {
      push(finding.path, {
        side: annotationSideOf(finding.side),
        lineNumber: finding.endLine,
        metadata: { kind: "finding", finding },
      });
    }
    if (composerTarget) {
      push(composerTarget.path, {
        side: annotationSideOf(composerTarget.side),
        lineNumber: composerTarget.line,
        metadata: { kind: "composer", target: composerTarget },
      });
    }
    return map;
  }, [threads, pendingComments, findings, composerTarget]);

  // Whatever is annotated stays unfolded, or its card goes with the line — so
  // the hide-whitespace rewrite depends on the annotations, and only then.
  // `keepLinesByPath` is shared with find-in-diff, which rebuilds this same
  // patch to scan the text actually on screen.
  //
  // This is the ONE gate that keeps the parse below stable, and the parse's
  // object identity is load-bearing: `loadDiffFiles` hydrates that exact object
  // in place and the library keys expansion state to it
  // (`fileDiff !== this.fileDiff` resets the file). With the toggle off this
  // returns one identity forever, so staging a comment cannot cost the reader
  // an expanded region. With it ON the patch really does depend on the
  // annotations, so an edit re-parses and expansions reset — the honest
  // behaviour, not something to paper over.
  const keepByPath = useMemo(
    () =>
      hideWhitespace
        ? keepLinesByPath({
            threads,
            pendingComments,
            findings,
            composerTarget,
          })
        : NO_KEEP_BY_PATH,
    [hideWhitespace, threads, pendingComments, findings, composerTarget],
  );

  // Patch and parse together: they recompute on exactly the same inputs, and
  // pairing them is what lets the loader prove a patch belongs to the fileDiff
  // it was handed rather than trusting a lookup by path.
  const { diffByPath, whitespaceOnlyPaths } = useMemo(() => {
    const diffs = new Map<
      string,
      { fileDiff: FileDiffMetadata; patch: string; index: DiffLineIndex }
    >();
    const whitespaceOnly = new Set<string>();
    for (const file of files) {
      // binary / tooLarge — listed in the FileTree with a badge instead
      const patch = renderedPatch(
        file,
        hideWhitespace,
        keepByPath.get(file.path),
      );
      if (patch === null) continue;
      // Headers but no hunks: everything this file changed was whitespace.
      if (hideWhitespace && !hasHunks(patch)) whitespaceOnly.add(file.path);
      const fileDiff = parsePatchFiles(
        patch,
        `${headSha}:${file.path}:${hideWhitespace ? "w" : "a"}`,
      )[0]?.files[0];
      // The index rides along: every range gesture clamps against it, and it
      // is derived from exactly the patch this memo just built.
      if (fileDiff)
        diffs.set(file.path, { fileDiff, patch, index: diffLineIndex(patch) });
    }
    return { diffByPath: diffs, whitespaceOnlyPaths: whitespaceOnly };
  }, [files, hideWhitespace, keepByPath, headSha]);

  const items = useMemo(() => {
    const out: CodeViewDiffItem<TandemAnno>[] = [];
    for (const file of files) {
      const parsed = diffByPath.get(file.path);
      if (!parsed) continue;
      const annotations = annotationsByPath.get(file.path) ?? EMPTY_ANNOS;
      const collapsed = collapsedPaths.has(file.path);
      out.push({
        id: file.path,
        type: "diff",
        fileDiff: parsed.fileDiff,
        annotations,
        collapsed,
        version: versionOf(headSha, annotations, collapsed, hideWhitespace),
      });
    }
    return out;
  }, [
    files,
    diffByPath,
    annotationsByPath,
    collapsedPaths,
    headSha,
    hideWhitespace,
  ]);

  // The loader must not re-identify when the diffs do: a new `loadDiffFiles`
  // makes the whole options object unequal and pushes a setOptions through the
  // library on every annotation edit. It only ever runs on a chevron click,
  // long after render, so it reads off a ref — the same snapshot pattern the
  // detail key handler uses. The identity check matters: the library may hand
  // back a fileDiff the pane has since replaced, and reversing a DIFFERENT
  // patch would render a wrong old side with nothing to show for it.
  const queryClient = useQueryClient();
  const diffsRef = useRef(diffByPath);
  useEffect(() => {
    diffsRef.current = diffByPath;
  }, [diffByPath]);
  const loadDiffFiles = useCallback(
    (fileDiff: FileDiffMetadata) => {
      const parsed = diffsRef.current.get(fileDiff.name);
      return loadDiffFileSides(fileDiff, {
        queryClient,
        prId,
        headSha,
        patch: parsed?.fileDiff === fileDiff ? parsed.patch : undefined,
      });
    },
    [queryClient, prId, headSha],
  );

  /**
   * The library keeps exactly ONE selected line range for the whole view, and
   * that is the right budget: it marks what you are talking about right now.
   * The composer's range owns it while a composer is open; then the find-in-
   * diff hit, because while the bar is open that IS what you are pointed at;
   * otherwise the focused card or finding lights up its own span, which is the
   * only way a range finding shows its height instead of just its anchor line.
   *
   * Selection is UNCONTROLLED (no `selectedLines` prop): the library paints a
   * drag itself, with no React work per pointermove. This only writes the
   * committed state back, so the highlight survives the drag ending and dies
   * with the composer.
   */
  const focusedFindingId = useUiStore((s) => s.focusedFindingId);
  const focusedCommentId = useUiStore((s) => s.focusedCommentId);
  const selection = useMemo<CodeViewLineSelection | null>(() => {
    // The composer wins; otherwise whichever card the reader is pointed at.
    // Every claimant is reduced to one {path, side, startLine, end} shape, so
    // the span rule is applied once and a RANGE card of any kind shows its
    // height rather than just its anchor line. `end` is null for a thread that
    // is outdated against this diff — nothing to highlight.
    const anchored = (
      a: { path: string; side: DiffSide; startLine?: number } | undefined,
      end: number | null | undefined,
    ): CodeViewLineSelection | null => {
      if (!a || end == null) return null;
      const span = spanOf(a.startLine, end);
      return {
        id: a.path,
        range: { ...span, side: annotationSideOf(a.side) },
      };
    };
    const composer = composerTarget ?? undefined;
    const comment = pendingComments.find((c) => c.localId === focusedCommentId);
    const thread = threads.find((t) => t.id === focusedCommentId);
    const finding = findings.find((f) => f.id === focusedFindingId);
    return (
      anchored(composer, composer?.line) ??
      anchored(searchHit ?? undefined, searchHit?.line) ??
      anchored(comment, comment?.line) ??
      anchored(thread, thread?.line) ??
      anchored(finding, finding?.endLine)
    );
  }, [
    composerTarget,
    searchHit,
    pendingComments,
    threads,
    findings,
    focusedCommentId,
    focusedFindingId,
  ]);
  useEffect(() => {
    codeViewRef.current?.setSelectedLines(selection);
  }, [selection, codeViewRef]);

  /**
   * The diff text under a composer's range — what a suggestion starts as.
   * Called during render (it is a value prop, not a callback the library
   * holds), so it reads `diffByPath` directly and needs no stable identity.
   */
  const sourceTextOf = (target: ComposerTarget) => {
    const patch = diffByPath.get(target.path)?.patch;
    if (!patch) return null;
    const { start, end } = spanOf(target.startLine, target.line);
    return patchLineText(patch, target.side, start, end);
  };

  /**
   * Grow (-1) or shrink (+1) an open composer's range from the TOP. The anchor
   * never moves: the card would jump out from under the cursor mid-sentence,
   * and "the problem actually starts further up" is the direction people
   * reach for. The composer re-reads the new range's text off `sourceText` on
   * the render this triggers, so there is nothing to hand back.
   *
   * Reads the patch off the ref for the same reason `commitSelection` does:
   * this lands long after render, and a fresh identity would push a
   * setOptions through the library on every annotation edit.
   */
  const extendComposerRange = useCallback(
    (delta: -1 | 1) => {
      const target = useUiStore.getState().composerTarget;
      const parsed = target && diffsRef.current.get(target.path);
      if (!target || !parsed) return;
      const { start: first } = spanOf(target.startLine, target.line);
      const range = clampCommentRange(
        parsed.index,
        target.side,
        Math.min(target.line, first + delta),
        target.line,
      );
      if (!range || range.start === first) return;
      setComposerTarget({
        ...target,
        startLine: startLineOf(range.start, range.end),
      });
    },
    [setComposerTarget],
  );

  /**
   * A committed line selection becomes the composer's target. Reads the patch
   * off the ref for the same reason `loadDiffFiles` does — this lands long
   * after render, and a fresh identity here would push a setOptions through
   * the library on every annotation edit. The selection's own rules (side
   * defaulting, a crossed split-view drag, the clamp) live in
   * `commentAnchorOf`, where they are testable.
   */
  const commitSelection = useCallback(
    (range: SelectedLineRange | null, path: string) => {
      if (!range) {
        setComposerTarget(null);
        return;
      }
      const parsed = diffsRef.current.get(path);
      if (!parsed) return;
      const anchor = commentAnchorOf(range, parsed.index);
      if (anchor) setComposerTarget({ path, ...anchor });
    },
    [setComposerTarget],
  );

  const options = useMemo<CodeViewReactOptions<TandemAnno>>(
    () => ({
      diffStyle,
      theme: { dark: "github-dark", light: "github-light" },
      themeType:
        resolveTheme(themePreference) === "future-dark" ? "dark" : "light",
      stickyHeaders: true,
      // Our renderCustomHeader is h-9 (36px), the library reserves 44 by
      // default. Left unsaid, every item's layout height runs 8px ahead of
      // what it renders — with all files folded that added up to ~150px of
      // padding above the first row, since the view centres its render window
      // in the leftover space when the layout total exceeds the real content.
      itemMetrics: { diffHeaderHeight: 36 },
      lineHoverHighlight: "line",
      // A patch-parsed diff is partial, so the expand chevrons appear only
      // once a loader can hand the library both full sides.
      loadDiffFiles,
      expansionLineCount: EXPANSION_LINE_COUNT,
      // Clicking any line opens the composer there (spec §3.2).
      onLineClick: (props, context) => {
        if (!("annotationSide" in props) || context.type !== "diff") return;
        if (!isCommentableLine(props.lineType)) return;
        setComposerTarget({
          path: context.item.id,
          line: props.lineNumber,
          side: diffSideOf(props.annotationSide),
        });
      },
      // Multi-line comments. The library's selection starts on the line-NUMBER
      // column only, so dragging it picks a range while dragging over the code
      // still selects text; shift-click extends an existing range. The ⊕ the
      // library parks on the hovered number is the same gesture with a
      // handle — and the part that makes the feature discoverable at all.
      enableLineSelection: true,
      enableGutterUtility: true,
      // The mere presence of this arms the ⊕ drag. Both gestures then commit
      // through onLineSelected, so there is one place a range becomes a
      // comment target.
      onGutterUtilityClick: () => {},
      onLineSelected: (range, context) => {
        if (context.type !== "diff") return;
        commitSelection(range, context.item.id);
      },
      // A number-column click IS the one-line case of a selection — letting it
      // fall through to onLineClick would open the composer twice.
      onLineNumberClick: () => {},
    }),
    [
      diffStyle,
      themePreference,
      setComposerTarget,
      loadDiffFiles,
      commitSelection,
    ],
  );

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No renderable diff — binary or oversized files only. Open the PR on
        GitHub to see them.
      </div>
    );
  }

  return (
    <CodeView<TandemAnno>
      ref={codeViewRef}
      items={items}
      options={options}
      // CodeView scrolls its own container — it must be the overflow parent.
      className="flex-1 min-h-0 overflow-y-auto"
      // Slotted into the library's sticky header (light DOM, so Tailwind
      // reaches it). Re-renders through React like the annotations do.
      renderCustomHeader={(item) => {
        const file = fileByPath.get(item.id);
        if (!file) return null;
        return (
          <DiffFileHeader
            file={file}
            viewed={viewedPaths.has(file.path)}
            collapsed={collapsedPaths.has(file.path)}
            hasFindings={findingPaths.has(file.path)}
            whitespaceOnly={whitespaceOnlyPaths.has(file.path)}
            onSelectPath={() => onSelectPath(file.path)}
            onToggleViewed={() => onToggleViewed(file.path)}
            onToggleCollapsed={() => onToggleCollapsed(file.path)}
          />
        );
      }}
      renderAnnotation={(annotation) => {
        const meta = annotation.metadata;
        switch (meta.kind) {
          case "thread":
            return <ThreadCard thread={meta.thread} />;
          case "composer":
            return (
              <ComposerCard
                target={meta.target}
                sourceText={sourceTextOf(meta.target)}
                onExtendRange={extendComposerRange}
                onCancel={() => setComposerTarget(null)}
                onSubmit={(body, suggestion) => {
                  onAddComment({
                    path: meta.target.path,
                    line: meta.target.line,
                    startLine: meta.target.startLine,
                    side: meta.target.side,
                    body,
                    suggestion,
                  });
                  setComposerTarget(null);
                }}
              />
            );
          case "pending":
            return (
              <PendingCard
                comment={meta.comment}
                onUpdate={(patch) =>
                  onUpdateComment(meta.comment.localId, patch)
                }
                onRemove={() => onRemoveComment(meta.comment.localId)}
              />
            );
          case "finding":
            return (
              <FindingCard finding={meta.finding} addComment={onAddComment} />
            );
          default:
            return null;
        }
      }}
    />
  );
}
