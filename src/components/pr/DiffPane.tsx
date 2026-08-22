import { useMemo } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import { CodeView, type CodeViewDiffItem, type CodeViewHandle, type CodeViewReactOptions, type DiffLineAnnotation } from '@pierre/diffs/react';
import { buildFilePatch } from '../../shared/gh/patch';
import type { FileChange, ReviewThread } from '../../shared/review-types';
import { resolveTheme, useThemeStore } from '../../state/themeStore';
import { useUiStore } from '../../state/uiStore';
import { annotationSideOf, type TandemAnno } from './annotations';
import { ThreadCard } from './ThreadCard';

export type DiffPaneHandle = CodeViewHandle<TandemAnno>;

type Props = {
  headSha: string;
  files: FileChange[];
  threads: ReviewThread[];
  codeViewRef: React.Ref<DiffPaneHandle>;
};

const EMPTY_ANNOS: DiffLineAnnotation<TandemAnno>[] = [];

// Controlled CodeView items re-render only on version changes. Annotation
// CONTENT is a React render prop and updates through React regardless — the
// version only has to change when the diff (headSha) or annotation POSITIONS
// change, so a pure hash of exactly those inputs is enough.
function versionOf(headSha: string, annotations: DiffLineAnnotation<TandemAnno>[]): number {
  let h = 0;
  for (let i = 0; i < headSha.length; i++) h = (h * 31 + headSha.charCodeAt(i)) | 0;
  for (const a of annotations) h = (h * 31 + a.lineNumber * 2 + (a.side === 'additions' ? 1 : 0)) | 0;
  return ((h | 0) >>> 0) + annotations.length;
}

export function DiffPane({ headSha, files, threads, codeViewRef }: Props) {
  const diffStyle = useUiStore((s) => s.diffStyle);
  const themePreference = useThemeStore((s) => s.preference);

  const annotationsByPath = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<TandemAnno>[]>();
    for (const thread of threads) {
      // Outdated threads have no line against the current diff — the header
      // count still includes them; inline they would misanchor.
      if (thread.line === null) continue;
      const list = map.get(thread.path) ?? [];
      list.push({
        side: annotationSideOf(thread.side),
        lineNumber: thread.line,
        metadata: { kind: 'thread', thread },
      });
      map.set(thread.path, list);
    }
    return map;
  }, [threads]);

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
    }),
    [diffStyle, themePreference]
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
        if (meta.kind === 'thread') return <ThreadCard thread={meta.thread} />;
        return null;
      }}
    />
  );
}
