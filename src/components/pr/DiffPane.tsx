import { useMemo } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import { CodeView, type CodeViewDiffItem, type CodeViewHandle, type CodeViewReactOptions, type DiffLineAnnotation } from '@pierre/diffs/react';
import { buildFilePatch } from '../../shared/gh/patch';
import type { FileChange, PendingComment, ReviewThread } from '../../shared/review-types';
import { resolveTheme, useThemeStore } from '../../state/themeStore';
import { useUiStore } from '../../state/uiStore';
import { annotationSideOf, diffSideOf, type TandemAnno } from './annotations';
import { ComposerCard } from './ComposerCard';
import { PendingCard } from './PendingCard';
import { ThreadCard } from './ThreadCard';

export type DiffPaneHandle = CodeViewHandle<TandemAnno>;

type Props = {
  headSha: string;
  files: FileChange[];
  threads: ReviewThread[];
  pendingComments: PendingComment[];
  onAddComment: (comment: Omit<PendingComment, 'localId'>) => void;
  onUpdateComment: (localId: string, patch: Partial<PendingComment>) => void;
  onRemoveComment: (localId: string) => void;
  codeViewRef: React.Ref<DiffPaneHandle>;
};

const EMPTY_ANNOS: DiffLineAnnotation<TandemAnno>[] = [];

// Controlled CodeView items re-render only on version changes. Annotation
// CONTENT is a React render prop and updates through React regardless — the
// version only has to change when the diff (headSha) or annotation POSITIONS
// or COUNT change, so a pure hash of exactly those inputs is enough.
function versionOf(headSha: string, annotations: DiffLineAnnotation<TandemAnno>[]): number {
  let h = 0;
  for (let i = 0; i < headSha.length; i++) h = (h * 31 + headSha.charCodeAt(i)) | 0;
  for (const a of annotations) h = (h * 31 + a.lineNumber * 2 + (a.side === 'additions' ? 1 : 0)) | 0;
  return ((h | 0) >>> 0) + annotations.length;
}

export function DiffPane({ headSha, files, threads, pendingComments, onAddComment, onUpdateComment, onRemoveComment, codeViewRef }: Props) {
  const diffStyle = useUiStore((s) => s.diffStyle);
  const themePreference = useThemeStore((s) => s.preference);
  const composerTarget = useUiStore((s) => s.composerTarget);
  const setComposerTarget = useUiStore((s) => s.setComposerTarget);

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
      push(thread.path, { side: annotationSideOf(thread.side), lineNumber: thread.line, metadata: { kind: 'thread', thread } });
    }
    for (const comment of pendingComments) {
      push(comment.path, { side: annotationSideOf(comment.side), lineNumber: comment.line, metadata: { kind: 'pending', comment } });
    }
    if (composerTarget) {
      push(composerTarget.path, {
        side: annotationSideOf(composerTarget.side),
        lineNumber: composerTarget.line,
        metadata: { kind: 'composer' },
      });
    }
    return map;
  }, [threads, pendingComments, composerTarget]);

  const items = useMemo(() => {
    const out: CodeViewDiffItem<TandemAnno>[] = [];
    for (const file of files) {
      const patch = buildFilePatch(file);
      if (!patch) continue; // binary / tooLarge — listed in the FileTree with a badge instead
      const fileDiff = parsePatchFiles(patch, `${headSha}:${file.path}`)[0]?.files[0];
      if (!fileDiff) continue;
      const annotations = annotationsByPath.get(file.path) ?? EMPTY_ANNOS;
      out.push({
        id: file.path,
        type: 'diff',
        fileDiff,
        annotations,
        version: versionOf(headSha, annotations),
      });
    }
    return out;
  }, [files, headSha, annotationsByPath]);

  const options = useMemo<CodeViewReactOptions<TandemAnno>>(
    () => ({
      diffStyle,
      theme: { dark: 'github-dark', light: 'github-light' },
      themeType: resolveTheme(themePreference) === 'future-dark' ? 'dark' : 'light',
      stickyHeaders: true,
      lineHoverHighlight: 'line',
      // Clicking any line opens the composer there (spec §3.2).
      onLineClick: (props, context) => {
        if (!('annotationSide' in props) || context.type !== 'diff') return;
        setComposerTarget({ path: context.item.id, line: props.lineNumber, side: diffSideOf(props.annotationSide) });
      },
    }),
    [diffStyle, themePreference, setComposerTarget]
  );

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No renderable diff — binary or oversized files only. Open the PR on GitHub to see them.
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
      renderAnnotation={(annotation) => {
        const meta = annotation.metadata;
        switch (meta.kind) {
          case 'thread':
            return <ThreadCard thread={meta.thread} />;
          case 'composer':
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
          case 'pending':
            return (
              <PendingCard
                comment={meta.comment}
                onUpdate={(patch) => onUpdateComment(meta.comment.localId, patch)}
                onRemove={() => onRemoveComment(meta.comment.localId)}
              />
            );
          default:
            return null;
        }
      }}
    />
  );
}
