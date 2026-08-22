import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, cn } from '@uipath/apollo-wind';
import { ExternalLink } from 'lucide-react';
import { startRun } from '../../api/runs';
import { acceptFinding, dismissFinding, unstageFinding } from '../../hooks/findingActions';
import { openPrExternal } from '../../hooks/queueActions';
import { runFor, useAgentRuns } from '../../hooks/useAgentRuns';
import { usePendingReview } from '../../hooks/usePendingReview';
import { usePrDetail, usePrFiles } from '../../hooks/usePrDetail';
import { useRunStream } from '../../hooks/useRunStream';
import { useSettings } from '../../hooks/useSettings';
import { hasOpenDialog, isTypingTarget } from '../../keyboard/target';
import { navigate } from '../../routes';
import type { Finding } from '../../shared/agent-types';
import type { PrId, ReviewVerdict } from '../../shared/review-types';
import { useUiStore } from '../../state/uiStore';
import { AgentPane } from '../agent/AgentPane';
import { TopBar } from '../layout/TopBar';
import { DescriptionCollapse } from './DescriptionCollapse';
import { DiffPane, type DiffPaneHandle } from './DiffPane';
import { FileTree } from './FileTree';
import { PrHeader } from './PrHeader';
import { ReviewTray } from './ReviewTray';

export function PrDetailView({ prId }: { prId: PrId }) {
  const queryClient = useQueryClient();
  const detail = usePrDetail(prId);
  const headSha = detail.data?.pr.headSha;
  const filesQuery = usePrFiles(prId, headSha);
  const { review, toggleViewed, addComment, updateComment, removeComment, setVerdict, setSummary } = usePendingReview(prId, headSha);
  const runs = useAgentRuns();
  const run = runFor(runs.data, prId, headSha);
  const progress = useRunStream(run);
  const settings = useSettings();

  const codeViewRef = useRef<DiffPaneHandle>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const files = filesQuery.data;

  const triageFindings = (run?.findings ?? []).filter((f) => f.state === 'proposed' || f.state === 'edited');
  const agentPaths = new Set(triageFindings.map((f) => f.path));

  // A composer or finding focus left over from another PR must not follow us.
  const setComposerTarget = useUiStore((s) => s.setComposerTarget);
  useEffect(() => {
    setComposerTarget(null);
    useUiStore.getState().setFocusedFinding(null);
    return () => {
      setComposerTarget(null);
      useUiStore.getState().setFocusedFinding(null);
    };
  }, [setComposerTarget]);

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

  const focusFinding = (finding: Finding) => {
    useUiStore.getState().setFocusedFinding(finding.id);
    setSelectedPath(finding.path);
    const target = {
      type: 'line',
      id: finding.path,
      lineNumber: finding.endLine,
      side: finding.side === 'LEFT' ? 'deletions' : 'additions',
      align: 'center',
    } as const;
    codeViewRef.current?.scrollTo(target);
    window.setTimeout(() => codeViewRef.current?.scrollTo(target), 350);
  };

  // Removing an agent-authored staged comment returns its finding to triage.
  const removeCommentAndUnstage = (localId: string) => {
    const comment = review?.comments.find((c) => c.localId === localId);
    removeComment(localId);
    if (comment?.findingId && run) void unstageFinding(queryClient, run.id, comment.findingId);
  };

  // Detail-scoped keys (the global handler only runs on the queue route):
  // esc back · [ ] files · j/k findings · y/e/x triage · v viewed · r rerun ·
  // a verdict approve · o open on GitHub.
  const keyState = useRef({ files, selectedPath, prUrl: detail.data?.pr.url, triageFindings, run });
  useEffect(() => {
    keyState.current = { files, selectedPath, prUrl: detail.data?.pr.url, triageFindings, run };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hasOpenDialog() || isTypingTarget(e.target)) return;
      const state = keyState.current;
      const paths = (state.files ?? []).map((f) => f.path);
      const stepFile = (delta: 1 | -1) => {
        if (paths.length === 0) return;
        const idx = state.selectedPath ? paths.indexOf(state.selectedPath) : -1;
        const next = idx === -1 ? 0 : Math.min(paths.length - 1, Math.max(0, idx + delta));
        selectFile(paths[next]);
      };
      const stepFinding = (delta: 1 | -1) => {
        const list = state.triageFindings;
        if (list.length === 0) return;
        const focusedId = useUiStore.getState().focusedFindingId;
        const idx = list.findIndex((f) => f.id === focusedId);
        const next = idx === -1 ? (delta === 1 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, idx + delta));
        focusFinding(list[next]);
      };
      const focused = () => state.triageFindings.find((f) => f.id === useUiStore.getState().focusedFindingId);

      switch (e.key) {
        case 'Escape': {
          e.preventDefault();
          // First Esc closes an open composer; the next one leaves the PR.
          if (useUiStore.getState().composerTarget) {
            useUiStore.getState().setComposerTarget(null);
            return;
          }
          navigate({ name: 'queue' });
          return;
        }
        case '[':
          e.preventDefault();
          stepFile(-1);
          return;
        case ']':
          e.preventDefault();
          stepFile(1);
          return;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          stepFinding(1);
          return;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          stepFinding(-1);
          return;
        case 'y': {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            void acceptFinding(queryClient, finding, addComment);
          }
          return;
        }
        case 'e': {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            useUiStore.getState().setEditingFinding(finding.id);
          }
          return;
        }
        case 'x': {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            void dismissFinding(queryClient, finding);
          }
          return;
        }
        case 'r':
          e.preventDefault();
          void startRun(prId, true).then(() => queryClient.invalidateQueries({ queryKey: ['runs'] }));
          return;
        case 'a':
          e.preventDefault();
          setVerdict('APPROVE' as ReviewVerdict);
          return;
        case 'v':
          if (state.selectedPath) {
            e.preventDefault();
            toggleViewed(state.selectedPath);
          }
          return;
        case 'o':
          if (state.prUrl) {
            e.preventDefault();
            openPrExternal(state.prUrl);
          }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Handlers read live state through keyState/getState snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, queryClient]);

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
          <div>
            Could not load {prId}: {detail.error instanceof Error ? detail.error.message : 'not found'}
          </div>
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
              agentPaths={agentPaths}
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
                      className={cn(
                        'px-2 py-0.5 text-[11px] font-mono',
                        diffStyle === style ? 'bg-accent text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {style}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Open on GitHub" onClick={() => openPrExternal(pr.url)}>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
              <DiffPane
                headSha={pr.headSha}
                files={files}
                threads={threads}
                pendingComments={review?.comments ?? []}
                findings={triageFindings}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                onRemoveComment={removeCommentAndUnstage}
                codeViewRef={codeViewRef}
              />
            </div>
            <AgentPane prId={prId} run={run} progress={progress} settings={settings.data} onSelectFinding={focusFinding} />
          </>
        )}
      </div>
      <ReviewTray prId={prId} review={review} onVerdict={setVerdict} onSummary={setSummary} />
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
