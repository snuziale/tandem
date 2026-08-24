import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@uipath/apollo-wind";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { startRun } from "../../api/runs";
import { openChatFor } from "../../actions/chat";
import {
  acceptFinding,
  dismissFinding,
  unstageFinding,
} from "../../actions/finding";
import { openPrExternal } from "../../actions/queue";
import { hasOpenBlocker, runFor, useAgentRuns } from "../../hooks/useAgentRuns";
import { usePendingReview } from "../../hooks/usePendingReview";
import { usePrDetail, usePrFiles } from "../../hooks/usePrDetail";
import { useRunStream } from "../../hooks/useRunStream";
import { useMarkSeen } from "../../hooks/useSeen";
import { useSettings } from "../../hooks/useSettings";
import { hasOpenDialog, isTypingTarget } from "../../keyboard/keyOwnership";
import { navigateToQueue } from "../../routes";
import type { Finding } from "../../shared/agent-types";
import type {
  PrId,
  PullRequest,
  ReviewVerdict,
} from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import { AgentPane } from "../agent/AgentPane";
import { AppHeader } from "../layout/AppHeader";
import { DescriptionCollapse } from "./DescriptionCollapse";
import { DiffPane, type DiffPaneHandle } from "./DiffPane";
import { FileTree } from "./FileTree";
import { PrBreadcrumb, PrHeader } from "./PrHeader";
import { ReviewTray } from "./ReviewTray";

const NO_FILES: string[] = [];

/** Show/hide one side pane, so the diff can take the whole width. */
function PaneToggle({
  side,
  open,
  label,
  onToggle,
}: {
  side: "left" | "right";
  open: boolean;
  label: string;
  onToggle: () => void;
}) {
  // Open-arrow icon while hidden (what the click will do), close while shown.
  const Icon = open
    ? side === "left"
      ? PanelLeftClose
      : PanelRightClose
    : side === "left"
      ? PanelLeftOpen
      : PanelRightOpen;
  const text = `${open ? "Hide" : "Show"} ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label={text}
          aria-pressed={open}
          onClick={onToggle}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{text}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export function PrDetailView({ prId }: { prId: PrId }) {
  const queryClient = useQueryClient();
  const detail = usePrDetail(prId);
  const headSha = detail.data?.pr.headSha;
  const filesQuery = usePrFiles(prId, headSha);
  const {
    review,
    toggleViewed,
    addComment,
    updateComment,
    removeComment,
    setVerdict,
    setSummary,
  } = usePendingReview(prId, headSha);
  const runs = useAgentRuns();
  const run = runFor(runs.data, prId, headSha);
  const progress = useRunStream(run);
  const settings = useSettings();
  // Opening the PR clears its "unseen changes" marker in the queue.
  useMarkSeen(prId, detail.data?.pr.updatedAt);

  const codeViewRef = useRef<DiffPaneHandle>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const files = filesQuery.data;

  // Fold state is DERIVED: a viewed file is folded, because that's the point
  // of marking it viewed. The chevron writes an override for that one path;
  // toggling viewed drops the override so the default takes over again.
  const [foldOverrides, setFoldOverrides] = useState<Record<string, boolean>>(
    {},
  );
  // Stable identity when there's no draft yet — it feeds a memo dep list.
  const viewedFiles = review?.viewedFiles ?? NO_FILES;
  const collapsedPaths = useMemo(() => {
    const viewed = new Set(viewedFiles);
    const out = new Set<string>();
    for (const path of new Set([...viewed, ...Object.keys(foldOverrides)])) {
      if (foldOverrides[path] ?? viewed.has(path)) out.add(path);
    }
    return out;
  }, [viewedFiles, foldOverrides]);

  const toggleCollapsed = useCallback(
    (path: string) =>
      setFoldOverrides((prev) => ({
        ...prev,
        [path]: !(prev[path] ?? collapsedPaths.has(path)),
      })),
    [collapsedPaths],
  );
  // Marking viewed re-derives the fold, so the checkbox folds and unfolds.
  const toggleViewedAndFold = useCallback(
    (path: string) => {
      setFoldOverrides((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      toggleViewed(path);
    },
    [toggleViewed],
  );
  const expandPath = useCallback((path: string) => {
    setFoldOverrides((prev) => ({ ...prev, [path]: false }));
  }, []);

  const triageFindings = (run?.findings ?? []).filter(
    (f) => f.state === "proposed" || f.state === "edited",
  );
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
    expandPath(path);
    // Item offsets are virtualized estimates until neighbours have been
    // measured — the first scroll gets close, the second (post-measurement)
    // lands exactly. Same trick @pierre's own viewer uses. The file tree
    // follows `selectedPath` on its own.
    scrollToTwice({ type: "item", id: path, align: "start" });
  };

  // Holding ] steps files faster than the follow-up scroll lands, and each
  // stale timer yanks the pane to a file the reader has already left — that's
  // the flicker. Only the newest follow-up survives.
  const followUpScroll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToTwice = (target: Parameters<DiffPaneHandle["scrollTo"]>[0]) => {
    codeViewRef.current?.scrollTo(target);
    if (followUpScroll.current) clearTimeout(followUpScroll.current);
    followUpScroll.current = window.setTimeout(() => {
      followUpScroll.current = null;
      codeViewRef.current?.scrollTo(target);
    }, 350) as unknown as ReturnType<typeof setTimeout>;
  };
  useEffect(
    () => () => {
      if (followUpScroll.current) clearTimeout(followUpScroll.current);
    },
    [],
  );

  const focusFinding = (finding: Finding) => {
    useUiStore.getState().setFocusedFinding(finding.id);
    setSelectedPath(finding.path);
    // Scrolling to a line inside a folded file would land on its header.
    expandPath(finding.path);
    scrollToTwice({
      type: "line",
      id: finding.path,
      lineNumber: finding.endLine,
      side: finding.side === "LEFT" ? "deletions" : "additions",
      align: "center",
    });
  };

  // Removing an agent-authored staged comment returns its finding to triage.
  const removeCommentAndUnstage = (localId: string) => {
    const comment = review?.comments.find((c) => c.localId === localId);
    removeComment(localId);
    if (comment?.findingId && run)
      void unstageFinding(queryClient, run.id, comment.findingId);
  };

  // Detail-scoped keys (the global handler only runs on the queue route):
  // esc back · [ ] files · j/k findings · y/e/x triage · c chat · v viewed ·
  // r rerun · a verdict approve · o open on GitHub.
  const keyState = useRef({
    files,
    selectedPath,
    prUrl: detail.data?.pr.url,
    triageFindings,
    run,
  });
  useEffect(() => {
    keyState.current = {
      files,
      selectedPath,
      prUrl: detail.data?.pr.url,
      triageFindings,
      run,
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hasOpenDialog() || isTypingTarget(e.target)) return;
      // The @pierre/trees tree owns its keys (arrows, type-ahead a-z, its
      // search input) — never double-handle while focus is inside it.
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("[data-tandem-filetree]")
      )
        return;
      const state = keyState.current;
      const paths = (state.files ?? []).map((f) => f.path);
      const stepFile = (delta: 1 | -1) => {
        if (paths.length === 0) return;
        const idx = state.selectedPath ? paths.indexOf(state.selectedPath) : -1;
        const next =
          idx === -1 ? 0 : Math.min(paths.length - 1, Math.max(0, idx + delta));
        selectFile(paths[next]);
      };
      const stepFinding = (delta: 1 | -1) => {
        const list = state.triageFindings;
        if (list.length === 0) return;
        const focusedId = useUiStore.getState().focusedFindingId;
        const idx = list.findIndex((f) => f.id === focusedId);
        const next =
          idx === -1
            ? delta === 1
              ? 0
              : list.length - 1
            : Math.min(list.length - 1, Math.max(0, idx + delta));
        focusFinding(list[next]);
      };
      const focused = () =>
        state.triageFindings.find(
          (f) => f.id === useUiStore.getState().focusedFindingId,
        );

      switch (e.key) {
        case "Escape": {
          e.preventDefault();
          // First Esc closes an open composer; the next one leaves the PR.
          if (useUiStore.getState().composerTarget) {
            useUiStore.getState().setComposerTarget(null);
            return;
          }
          navigateToQueue();
          return;
        }
        case "[":
          e.preventDefault();
          stepFile(-1);
          return;
        case "]":
          e.preventDefault();
          stepFile(1);
          return;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          stepFinding(1);
          return;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          stepFinding(-1);
          return;
        case "y": {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            void acceptFinding(queryClient, finding, addComment);
          }
          return;
        }
        case "e": {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            useUiStore.getState().setEditingFinding(finding.id);
          }
          return;
        }
        case "x": {
          const finding = focused();
          if (finding) {
            e.preventDefault();
            void dismissFinding(queryClient, finding);
          }
          return;
        }
        case "c":
          // Chat about the focused finding, or the PR when nothing is focused.
          e.preventDefault();
          openChatFor(useUiStore.getState().focusedFindingId);
          return;
        case "r":
          e.preventDefault();
          void startRun(prId, true).then(() =>
            queryClient.invalidateQueries({ queryKey: ["runs"] }),
          );
          return;
        case "a":
          e.preventDefault();
          setVerdict("APPROVE" as ReviewVerdict);
          return;
        case "v":
          if (state.selectedPath) {
            e.preventDefault();
            toggleViewedAndFold(state.selectedPath);
          }
          return;
        case "o":
          if (state.prUrl) {
            e.preventDefault();
            openPrExternal(state.prUrl);
          }
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers read live state through keyState/getState snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, queryClient]);

  const diffStyle = useUiStore((s) => s.diffStyle);
  const setDiffStyle = useUiStore((s) => s.setDiffStyle);
  // Pane widths outlive this screen: it remounts per PR (keyed on prId), so the
  // layout is read from / written back to the persisted store, not local state.
  const paneLayout = useUiStore((s) => s.prPaneLayout);
  const setPaneLayout = useUiStore((s) => s.setPrPaneLayout);
  // Hiding a side pane UNMOUNTS its panel rather than using the library's
  // `collapsible`: a collapsible panel that lands at zero width during the
  // group's first (zero-width) solve stays collapsed, which cost the agent
  // pane its whole width on load. Unmounting also means a drag can never
  // collapse a pane behind the toggle's back — minSize still bounds it.
  const filesOpen = useUiStore((s) => s.prFilesOpen);
  const agentOpen = useUiStore((s) => s.prAgentOpen);
  const setFilesOpen = useUiStore((s) => s.setPrFilesOpen);
  const setAgentOpen = useUiStore((s) => s.setPrAgentOpen);

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
            Could not load {prId}:{" "}
            {detail.error instanceof Error ? detail.error.message : "not found"}
          </div>
          <Button variant="outline" size="xs" onClick={navigateToQueue}>
            Back to queue
          </Button>
        </div>
      </Shell>
    );
  }

  const { pr, threads } = detail.data;

  return (
    <Shell pr={pr}>
      <PrHeader pr={pr} />
      <DescriptionCollapse body={pr.bodyMarkdown} />
      <div className="flex-1 min-h-0 flex">
        {filesQuery.isPending ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        ) : filesQuery.isError || !files ? (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive">
            Files failed to load:{" "}
            {filesQuery.error instanceof Error
              ? filesQuery.error.message
              : "unknown error"}
          </div>
        ) : (
          // react-resizable-panels v4: numeric sizes are PIXELS, strings are
          // percents; orientation defaults to horizontal.
          <ResizablePanelGroup
            className="flex-1 min-h-0"
            defaultLayout={paneLayout ?? undefined}
            // Only a real drag/keyboard resize is a preference; constraint
            // recomputes and window resizes must not overwrite it. MERGED, not
            // replaced: while a pane is hidden the layout carries only the
            // visible ids, and the hidden one's remembered width has to
            // survive for when it comes back.
            onLayoutChanged={(layout, meta) => {
              if (meta.isUserInteraction)
                setPaneLayout({ ...(paneLayout ?? {}), ...layout });
            }}
          >
            {filesOpen ? (
              <>
                <ResizablePanel
                  id="files"
                  defaultSize="15"
                  minSize={150}
                  maxSize="35"
                >
                  <FileTree
                    files={files}
                    viewedFiles={viewedFiles}
                    selectedPath={selectedPath}
                    onSelect={selectFile}
                    agentPaths={agentPaths}
                  />
                </ResizablePanel>
                <ResizableHandle />
              </>
            ) : null}
            <ResizablePanel id="diff" defaultSize="62" minSize="30">
              <div className="h-full min-w-0 flex flex-col">
                <div className="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
                  <PaneToggle
                    side="left"
                    open={filesOpen}
                    label="files"
                    onToggle={() => setFilesOpen((open) => !open)}
                  />
                  {/* No path here: every file header carries its own, and this
                      one only ever echoed the selection. */}
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono flex-1">
                    diff
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    viewed {viewedFiles.length}/{files.length}
                  </span>
                  <ToggleGroup
                    type="single"
                    size="xs"
                    variant="outline"
                    value={diffStyle}
                    onValueChange={(style) => {
                      if (style === "unified" || style === "split")
                        setDiffStyle(style);
                    }}
                    aria-label="Diff layout"
                  >
                    <ToggleGroupItem
                      value="unified"
                      className="font-mono text-[11px]"
                    >
                      unified
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="split"
                      className="font-mono text-[11px]"
                    >
                      split
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <PaneToggle
                    side="right"
                    open={agentOpen}
                    label="agent"
                    onToggle={() => setAgentOpen((open) => !open)}
                  />
                </div>
                <DiffPane
                  headSha={pr.headSha}
                  files={files}
                  threads={threads}
                  pendingComments={review?.comments ?? []}
                  findings={triageFindings}
                  viewedFiles={viewedFiles}
                  onToggleViewed={toggleViewedAndFold}
                  collapsedPaths={collapsedPaths}
                  onToggleCollapsed={toggleCollapsed}
                  // Path click in a file header reveals it in the tree; the
                  // diff is already at that file, so it must not re-scroll.
                  onSelectPath={setSelectedPath}
                  onAddComment={addComment}
                  onUpdateComment={updateComment}
                  onRemoveComment={removeCommentAndUnstage}
                  codeViewRef={codeViewRef}
                />
              </div>
            </ResizablePanel>
            {agentOpen ? (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="agent"
                  defaultSize="23"
                  minSize={240}
                  maxSize="45"
                >
                  <AgentPane
                    prId={prId}
                    headSha={pr.headSha}
                    run={run}
                    progress={progress}
                    settings={settings.data}
                    onSelectFinding={focusFinding}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        )}
      </div>
      <ReviewTray
        prId={prId}
        review={review}
        onVerdict={setVerdict}
        onSummary={setSummary}
        submitDisabledReason={
          review?.verdict === "APPROVE" && hasOpenBlocker(run)
            ? "The agent found a blocker — dismiss it or pick another verdict to approve"
            : undefined
        }
      />
    </Shell>
  );
}

function Shell({
  pr,
  children,
}: {
  pr?: PullRequest;
  children: React.ReactNode;
}) {
  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      {/* The breadcrumb is the detail screen's middle zone in the ONE header. */}
      <AppHeader>
        <PrBreadcrumb pr={pr} />
      </AppHeader>
      {children}
    </div>
  );
}
