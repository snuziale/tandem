import { useCallback, useEffect, useMemo, useRef } from "react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
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
  buildFilePatch,
  hasHunks,
  hideWhitespaceChanges,
  type KeepLines,
} from "../../shared/gh/patch";
import type {
  FileChange,
  PendingComment,
  PrId,
  ReviewThread,
} from "../../shared/review-types";
import { resolveTheme, useThemeStore } from "../../state/themeStore";
import { useUiStore } from "../../state/uiStore";
import { FindingCard } from "../agent/FindingCard";
import {
  annotationSideOf,
  diffSideOf,
  isCommentableLine,
  type TandemAnno,
} from "./annotations";
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
  codeViewRef: React.Ref<DiffPaneHandle>;
};

const EMPTY_ANNOS: DiffLineAnnotation<TandemAnno>[] = [];
/** Module constant so the keep map keeps ONE identity while hide-whitespace is
 * off — that is what holds the parsed diffs (and the reader's expansions)
 * still across annotation changes. See the keepByPath memo. */
const NO_KEEP_BY_PATH: ReadonlyMap<string, KeepLines> = new Map();

// GitHub's own step. The library defaults to 100, which overshoots what a
// reviewer wants when they are peeking just above a hunk.
const EXPANSION_LINE_COUNT = 20;

function keepLinesOf(annotations: DiffLineAnnotation<TandemAnno>[]): KeepLines {
  const left = new Set<number>();
  const right = new Set<number>();
  for (const a of annotations)
    (a.side === "deletions" ? left : right).add(a.lineNumber);
  return { left, right };
}

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
  for (const a of annotations)
    h = (h * 31 + a.lineNumber * 2 + (a.side === "additions" ? 1 : 0)) | 0;
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
        metadata: { kind: "composer" },
      });
    }
    return map;
  }, [threads, pendingComments, findings, composerTarget]);

  // Whatever is annotated stays unfolded, or its card goes with the line — so
  // the hide-whitespace rewrite depends on the annotations, and only then.
  //
  // This is the ONE gate that keeps the parse below stable, and the parse's
  // object identity is load-bearing: `loadDiffFiles` hydrates that exact object
  // in place and the library keys expansion state to it
  // (`fileDiff !== this.fileDiff` resets the file). With the toggle off this
  // returns one identity forever, so staging a comment cannot cost the reader
  // an expanded region. With it ON the patch really does depend on the
  // annotations, so an edit re-parses and expansions reset — the honest
  // behaviour, not something to paper over.
  const keepByPath = useMemo(() => {
    if (!hideWhitespace) return NO_KEEP_BY_PATH;
    const map = new Map<string, KeepLines>();
    for (const [path, annos] of annotationsByPath)
      map.set(path, keepLinesOf(annos));
    return map;
  }, [hideWhitespace, annotationsByPath]);

  // Patch and parse together: they recompute on exactly the same inputs, and
  // pairing them is what lets the loader prove a patch belongs to the fileDiff
  // it was handed rather than trusting a lookup by path.
  const { diffByPath, whitespaceOnlyPaths } = useMemo(() => {
    const diffs = new Map<
      string,
      { fileDiff: FileDiffMetadata; patch: string }
    >();
    const whitespaceOnly = new Set<string>();
    for (const file of files) {
      const raw = buildFilePatch(file);
      if (!raw) continue; // binary / tooLarge — listed in the FileTree with a badge instead
      const patch = hideWhitespace
        ? hideWhitespaceChanges(raw, keepByPath.get(file.path))
        : raw;
      // Headers but no hunks: everything this file changed was whitespace.
      if (hideWhitespace && !hasHunks(patch)) whitespaceOnly.add(file.path);
      const fileDiff = parsePatchFiles(
        patch,
        `${headSha}:${file.path}:${hideWhitespace ? "w" : "a"}`,
      )[0]?.files[0];
      if (fileDiff) diffs.set(file.path, { fileDiff, patch });
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
    }),
    [diffStyle, themePreference, setComposerTarget, loadDiffFiles],
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
            return composerTarget ? (
              <ComposerCard
                target={composerTarget}
                onCancel={() => setComposerTarget(null)}
                onSubmit={(body, suggestion) => {
                  onAddComment({
                    path: composerTarget.path,
                    line: composerTarget.line,
                    side: composerTarget.side,
                    body,
                    suggestion,
                  });
                  setComposerTarget(null);
                }}
              />
            ) : null;
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
