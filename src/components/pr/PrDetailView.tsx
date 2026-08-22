import { useEffect, useRef, useState } from 'react';
import { Button, Spinner, cn } from '@uipath/apollo-wind';
import { ExternalLink } from 'lucide-react';
import { openPrExternal } from '../../hooks/queueActions';
import { usePendingReview } from '../../hooks/usePendingReview';
import { usePrDetail, usePrFiles } from '../../hooks/usePrDetail';
import { hasOpenDialog, isTypingTarget } from '../../keyboard/target';
import { navigate } from '../../routes';
import type { PrId } from '../../shared/review-types';
import { useUiStore } from '../../state/uiStore';
import { TopBar } from '../layout/TopBar';
import { DescriptionCollapse } from './DescriptionCollapse';
import { DiffPane, type DiffPaneHandle } from './DiffPane';
import { FileTree } from './FileTree';
import { PrHeader } from './PrHeader';

export function PrDetailView({ prId }: { prId: PrId }) {
  const detail = usePrDetail(prId);
  const headSha = detail.data?.pr.headSha;
  const filesQuery = usePrFiles(prId, headSha);
  const { review, toggleViewed } = usePendingReview(prId, headSha);

  const codeViewRef = useRef<DiffPaneHandle>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const files = filesQuery.data;

  const selectFile = (path: string) => {
    setSelectedPath(path);
    // Item offsets are virtualized estimates until neighbours have been
    // measured — the first scroll gets close, the second (post-measurement)
    // lands exactly. Same trick @pierre's own viewer uses.
    const target = { type: 'item', id: path, align: 'start' } as const;
    codeViewRef.current?.scrollTo(target);
    window.setTimeout(() => codeViewRef.current?.scrollTo(target), 350);
    document.querySelector(`[data-file-row="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  // Detail-scoped keys (the global handler only runs on the queue route):
  // esc back · [ ] file nav · v viewed · o open on GitHub.
  const keyState = useRef({ files, selectedPath, review, prUrl: detail.data?.pr.url });
  useEffect(() => {
    keyState.current = { files, selectedPath, review, prUrl: detail.data?.pr.url };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hasOpenDialog() || isTypingTarget(e.target)) return;
      const { files, selectedPath, prUrl } = keyState.current;
      const paths = (files ?? []).map((f) => f.path);
      const step = (delta: 1 | -1) => {
        if (paths.length === 0) return;
        const idx = selectedPath ? paths.indexOf(selectedPath) : -1;
        const next = idx === -1 ? 0 : Math.min(paths.length - 1, Math.max(0, idx + delta));
        selectFile(paths[next]);
      };
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          navigate({ name: 'queue' });
          return;
        case '[':
          e.preventDefault();
          step(-1);
          return;
        case ']':
          e.preventDefault();
          step(1);
          return;
        case 'v':
          if (selectedPath) {
            e.preventDefault();
            toggleViewed(selectedPath);
          }
          return;
        case 'o':
          if (prUrl) {
            e.preventDefault();
            openPrExternal(prUrl);
          }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // selectFile/toggleViewed are stable enough via keyState snapshot reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diffStyle = useUiStore((s) => s.diffStyle);
  const setDiffStyle = useUiStore((s) => s.setDiffStyle);

  if (detail.isPending) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <Spinner />
        </div>
      </Shell>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <div>Could not load {prId}: {detail.error instanceof Error ? detail.error.message : 'not found'}</div>
          <Button variant="outline" size="sm" onClick={() => navigate({ name: 'queue' })}>
            Back to queue
          </Button>
        </div>
      </Shell>
    );
  }

  const { pr, threads } = detail.data;

  return (
    <Shell>
      <PrHeader pr={pr} />
      <DescriptionCollapse body={pr.bodyMarkdown} />
      <div className="flex-1 min-h-0 flex">
        {filesQuery.isPending ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        ) : filesQuery.isError || !files ? (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive">
            Files failed to load: {filesQuery.error instanceof Error ? filesQuery.error.message : 'unknown error'}
          </div>
        ) : (
          <>
            <FileTree
              files={files}
              viewedFiles={review?.viewedFiles ?? []}
              selectedPath={selectedPath}
              onSelect={selectFile}
              onToggleViewed={toggleViewed}
            />
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center gap-2 px-3 py-1 border-b border-border">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">diff</span>
                <span className="text-xs text-muted-foreground font-mono truncate flex-1">{selectedPath ?? ''}</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  viewed {review?.viewedFiles.length ?? 0}/{files.length}
                </span>
                <div className="flex border border-border rounded overflow-hidden">
                  {(['unified', 'split'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setDiffStyle(style)}
                      className={cn('px-2 py-0.5 text-[11px] font-mono', diffStyle === style ? 'bg-accent text-foreground' : 'text-muted-foreground')}
                    >
                      {style}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Open on GitHub" onClick={() => openPrExternal(pr.url)}>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
              <DiffPane headSha={pr.headSha} files={files} threads={threads} codeViewRef={codeViewRef} />
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <TopBar />
      {children}
    </div>
  );
}
