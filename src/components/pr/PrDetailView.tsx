import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Spinner,
  Toggle,
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
import { DiffPane, type DiffPaneHandle } from "./DiffPane";
import { FileTree } from "./FileTree";
import { PrBreadcrumb, PrHeader } from "./PrHeader";
import { ReviewTray } from "./ReviewTray";
import { Shortcut } from "../common/Kbd";

const NO_FILES: string[] = [];

/** Keys @pierre/trees consumes itself while the tree has focus. Everything
 * else must fall through to the detail keymap — see the guard in `onKey`. */
const TREE_OWNED_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
  " ",
  "Escape",
  "F2",
  "ContextMenu",
]);

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

  // Shared with the pane, which reads it for the diff's line selection.
  const codeViewRef = useRef<DiffPaneHandle | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const files = filesQuery.data;

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

  /**
   * Collapsing a file you are scrolled INSIDE of has to bring its header back
   * into view, or you lose your place: @pierre/diffs anchors the viewport to
   * the LINE you were looking at (`getScrollAnchor` falls through to
   * `getNumericScrollAnchor` once an item's top is above the scroll position),
   * and a collapsed file has no lines left to anchor to — so the scroll offset
   * was kept and you landed in some file further down, with the one you just
   * checked off somewhere above the fold.
   *
   * ONLY that case. While the header is still on screen the library takes an
   * ITEM anchor instead (`absoluteItemTop >= scrollTop`), which already holds
   * it exactly where it is as the content below shrinks — scrolling there too
   * would yank the page for no reason. So the test is precisely "has this
   * file's top gone past the viewport top", in the one coordinate space
   * `getScrollAnchor` itself compares.
   *
   * Scrolling FIRST is what makes this cooperate rather than fight: the
   * library skips capturing an anchor at all while a scroll target is pending
   * (`capturePendingLayoutAnchor` bails on `pendingScrollTarget`), so the bad
   * line anchor is never taken and the header lands at the top, collapsed and
   * ticked. Expanding needs none of this — a file grows DOWNWARD from a header
   * that is already the anchor.
   */
  const revealCollapsed = (path: string) => {
    const view = codeViewRef.current?.getInstance();
    const top = view?.getTopForItem(path);
    // Header still on screen → the library's ITEM anchor already holds it in
    // place while the content below shrinks. Nothing to do.
    if (view == null || top == null || top >= view.getScrollTop()) return;
    scrollToTwice({ type: "item", id: path, align: "start" });
  };

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

  // Plain functions, not useCallback: the React Compiler memoizes them on
  // their real dependencies (verified — they land in cache slots), and a
  // hand-written dep array here can only be a second, stale opinion.
  const toggleCollapsed = (path: string) => {
    const collapsing = !collapsedPaths.has(path);
    setFoldOverrides((prev) => ({ ...prev, [path]: collapsing }));
    if (collapsing) revealCollapsed(path);
  };
  // Marking viewed re-derives the fold, so the checkbox folds and unfolds.
  const toggleViewedAndFold = (path: string) => {
    // Dropping the override hands the fold back to viewed, so the file is
    // collapsing exactly when it is becoming viewed.
    const collapsing = !viewedFiles.includes(path);
    setFoldOverrides((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    toggleViewed(path);
    if (collapsing) revealCollapsed(path);
  };
  const expandPath = (path: string) => {
    setFoldOverrides((prev) => ({ ...prev, [path]: false }));
  };

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
  // w hide whitespace · r rerun · a verdict approve · o open on GitHub.
  //
  // `useEffectEvent`, so the handler reads THIS render's `files`/`selectedPath`
  // /`triageFindings` while the listener binds ONCE and never appears in a dep
  // list. Its predecessor snapshotted those into a ref behind an
  // `exhaustive-deps` suppression — and a suppression bails this whole
  // component out of the React Compiler, which is the only memoization it has
  // (see the pitfall in CLAUDE.md). Keep this file suppression-free.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (hasOpenDialog() || isTypingTarget(e.target)) return;
    // The tree owns only the keys it actually consumes. It used to own ALL of
    // them while focused, which meant clicking a file — the obvious way to
    // pick one — silently killed the whole detail keymap until you clicked
    // somewhere else. Letters are safe to take: the tree's a-z type-ahead is
    // gated on `searchEnabled`, and FileTree passes `search: false`, so it
    // never sees one. Its search box is an `<input>`, already covered by
    // `isTypingTarget` above.
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("[data-tandem-filetree]") &&
      TREE_OWNED_KEYS.has(e.key)
    )
      return;
    const paths = (files ?? []).map((f) => f.path);
    const stepFile = (delta: 1 | -1) => {
      if (paths.length === 0) return;
      const idx = selectedPath ? paths.indexOf(selectedPath) : -1;
      const next =
        idx === -1 ? 0 : Math.min(paths.length - 1, Math.max(0, idx + delta));
      selectFile(paths[next]);
    };
    const stepFinding = (delta: 1 | -1) => {
      if (triageFindings.length === 0) return;
      const focusedId = useUiStore.getState().focusedFindingId;
      const idx = triageFindings.findIndex((f) => f.id === focusedId);
      const next =
        idx === -1
          ? delta === 1
            ? 0
            : triageFindings.length - 1
          : Math.min(triageFindings.length - 1, Math.max(0, idx + delta));
      focusFinding(triageFindings[next]);
    };
    const focused = () =>
      triageFindings.find(
        (f) => f.id === useUiStore.getState().focusedFindingId,
      );

    switch (e.key) {
      case "Escape": {
        // Esc closes an open composer and nothing else. It used to fall
        // through to leaving the PR, which read as losing your place: Esc
        // is "dismiss the thing in front of me", and with no composer open
        // there is nothing in front of you. "← Queue" and the browser's
        // back both still leave.
        if (useUiStore.getState().composerTarget) {
          e.preventDefault();
          useUiStore.getState().setComposerTarget(null);
        }
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
      case "w":
        e.preventDefault();
        useUiStore.getState().setHideWhitespace((hide) => !hide);
        return;
      case "v": {
        // `[`/`]` already read "nothing selected yet" as "the first file"; `v`
        // used to give up instead, so on a freshly-opened PR it did nothing
        // and said nothing. Same fallback, and it SELECTS what it acted on so
        // the tree shows which file the next `v` will hit.
        const path = selectedPath ?? paths[0];
        if (path) {
          e.preventDefault();
          setSelectedPath(path);
          toggleViewedAndFold(path);
        }
        return;
      }
      case "o":
        if (detail.data) {
          e.preventDefault();
          openPrExternal(detail.data.pr.url);
        }
        return;
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const diffStyle = useUiStore((s) => s.diffStyle);
  const setDiffStyle = useUiStore((s) => s.setDiffStyle);
  const hideWhitespace = useUiStore((s) => s.hideWhitespace);
  const setHideWhitespace = useUiStore((s) => s.setHideWhitespace);
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
                  <ViewedMeter
                    viewed={viewedFiles.length}
                    total={files.length}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* A Toggle, not a Button: pressing changes the fill
                          only, so the control keeps its width. */}
                      <Toggle
                        size="xs"
                        variant="outline"
                        pressed={hideWhitespace}
                        onPressedChange={setHideWhitespace}
                        aria-label="Hide whitespace-only changes"
                        // Styled off aria-pressed, NOT data-state: the
                        // tooltip trigger owns data-state on its child, so
                        // the toggle's own on/off never reaches the DOM.
                        className="h-6 px-1.5 min-w-0 font-mono text-[11px] aria-pressed:bg-foreground/10 aria-pressed:border-foreground/40 aria-pressed:text-foreground future:aria-pressed:text-foreground"
                      >
                        ws
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent>
                        {hideWhitespace
                          ? "Show whitespace changes"
                          : "Hide whitespace changes"}
                        <Shortcut keys="w" className="ml-1.5" />
                      </TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
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
                  prId={prId}
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

/**
 * How far through the files you are. The count stays printed beside the mark —
 * the mark is the shape of the progress, never the only place the value lives.
 *
 * `--tandem-bar`, the app's neutral data mark, and deliberately not two other
 * things it could have been: NOT `--tandem-agent`, because violet means
 * machine-authored and this is the reviewer's own progress; and NOT a status
 * token turning green at 100%, because those are spoken for by checks, review
 * and pulse, and "colour is by JOB" — a full bar already says done.
 *
 * Fixed width, so the toolbar's controls hold their positions as the count
 * climbs from 5/75 to 34/75.
 */
function ViewedMeter({ viewed, total }: { viewed: number; total: number }) {
  const pct = total > 0 ? (viewed / total) * 100 : 0;
  return (
    <span
      className="flex items-center gap-1.5 shrink-0"
      title={`${viewed} of ${total} files marked viewed`}
    >
      <span className="text-[11px] text-muted-foreground font-mono">
        viewed {viewed}/{total}
      </span>
      <span
        aria-hidden
        className="inline-block align-middle w-12 h-1 rounded-[1px] overflow-hidden"
        style={{
          background: "color-mix(in srgb, var(--tandem-bar) 22%, transparent)",
        }}
      >
        <span
          className="block h-full rounded-[1px] transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${pct}%`, background: "var(--tandem-bar)" }}
        />
      </span>
    </span>
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
