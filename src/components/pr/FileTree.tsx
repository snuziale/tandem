import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree as TreesFileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel, GitStatusEntry } from "@pierre/trees";
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@uipath/apollo-wind";
import { Search, X } from "lucide-react";
import type { FileChange } from "../../shared/review-types";
import { resolveTheme, useThemeStore } from "../../state/themeStore";

type Props = {
  files: FileChange[];
  viewedFiles: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Paths with agent findings — violet dot decoration. */
  agentPaths?: ReadonlySet<string>;
  /** Hands the caller the tree model for scroll/select from keyboard + findings. */
  onModelReady?: (model: FileTreeModel) => void;
  /** The column header's own control, left of the search button — the
   * `Files | Description` tab group. Hidden while search owns the row. */
  headerAction: React.ReactNode;
  /** The id the column's tab strip points `aria-controls` at — one region,
   * whichever tab is showing in it. */
  panelId: string;
  /** Drawn over the rows, full height. An OVERLAY and not a swap: the tree
   * keeps its model, its scroll position and its measured size underneath —
   * and so does the overlay, which stays mounted behind `hidden` once opened.
   * That is why COVERED is a stated flag and not `overlay != null`: a mounted
   * but hidden panel is present and covers nothing. */
  overlay: React.ReactNode;
  /** True while the overlay covers the rows. It stands the search control
   * down — there is nothing of the tree to search past it. */
  overlayShown: boolean;
};

const GIT_STATUS: Record<FileChange["status"], GitStatusEntry["status"]> = {
  added: "added",
  removed: "deleted",
  modified: "modified",
  renamed: "renamed",
  copied: "added",
  changed: "modified",
  unchanged: "modified",
};

/** Point the tree at exactly ONE path and reveal it. `item.select()` is
 * additive, so everything else has to be deselected first — and it echoes back
 * through `onSelectionChange`, so `applying` has to come down however this
 * exits or the tree goes deaf to real clicks for the rest of the session.
 *
 * Module-level on purpose: the React Compiler skips a whole COMPONENT over a
 * `finally` with no catch, or an optional chain inside a `try`. It compiles
 * components and hooks, so down here both are free. */
function selectOnly(
  model: FileTreeModel,
  selectedPath: string,
  applying: { current: boolean },
) {
  applying.current = true;
  try {
    for (const path of model.getSelectedPaths())
      if (path !== selectedPath) model.getItem(path)?.deselect();
    const item = model.getItem(selectedPath);
    if (item && !item.isSelected()) item.select();
    model.scrollToPath(selectedPath, { offset: "nearest" });
  } finally {
    applying.current = false;
  }
}

// The PR file tree on @pierre/trees: real hierarchy with flattened empty
// dirs, always-virtualized, built-in search (the header's button / filters as
// you type), git-status badges from the PR's change types, sticky folders,
// and per-file decorations (+a −d · viewed ✓ · violet agent dot).
export function FileTree({
  files,
  viewedFiles,
  selectedPath,
  onSelect,
  agentPaths,
  onModelReady,
  headerAction,
  panelId,
  overlay,
  overlayShown,
}: Props) {
  // The model is constructed ONCE (useFileTree); everything row decorations
  // need at render time is read through this ref so it never goes stale.
  // Indexed, not the raw arrays: `renderRowDecoration` runs per VISIBLE ROW,
  // so a `files.find` and two `viewedFiles.includes` per row is O(files × rows)
  // every decoration pass — ~12k comparisons on a 300-file PR.
  const stateRef = useRef({
    byPath: new Map(files.map((f) => [f.path, f])),
    viewed: new Set(viewedFiles),
    agentPaths,
  });

  // `item.select()` fires onSelectionChange exactly like a click does, so the
  // effect below that makes the tree FOLLOW an external selection would echo
  // that selection straight back out as if the reader had picked it. That
  // round trip is not cosmetic: `onSelect` is `selectFile`, which scrolls the
  // diff to the file HEADER — so clicking an agent finding scrolled to its
  // line and was then yanked back to the top of the file, and only a second
  // click (with selectedPath already set, so this effect no-ops) landed on
  // the line. The flag is a ref because the model is built once and its
  // callbacks close over the first render.
  const applyingExternal = useRef(false);

  const paths = useMemo(() => files.map((f) => f.path), [files]);

  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    stickyFolders: true,
    density: "compact",
    // Our own search input lives in the header; the model still does the
    // filtering (setSearch works without the built-in UI).
    search: false,
    fileTreeSearchMode: "hide-non-matches",
    gitStatus: gitStatusOf(files),
    onSelectionChange: (selected) => {
      if (applyingExternal.current) return;
      const path = selected[selected.length - 1];
      if (!path) return;
      // Single selection, whoever asked: a modifier-click or range select
      // collapses to the row the reader landed on.
      if (selected.length > 1)
        for (const other of selected)
          if (other !== path) model.getItem(other)?.deselect();
      const item = model.getItem(path);
      if (item && !item.isDirectory()) onSelect(path);
    },
    renderRowDecoration: ({ row }) => {
      if (row.kind !== "file") return null;
      const { byPath, viewed, agentPaths } = stateRef.current;
      const file = byPath.get(row.path);
      if (!file) return null;
      const parts = [];
      if (agentPaths?.has(row.path))
        parts.push({ text: "● ", color: "var(--tandem-agent)" });
      if (file.isBinary || file.tooLarge) {
        parts.push({ text: file.isBinary ? "bin" : "big" });
      } else {
        parts.push({
          text: `+${file.additions}`,
          color: "var(--color-emerald-500, #10b981)",
        });
        parts.push({
          text: ` −${file.deletions}`,
          color: "var(--color-red-400, #f87171)",
        });
      }
      const isViewed = viewed.has(row.path);
      if (isViewed) parts.push({ text: " ✓" });
      return {
        text: parts.map((p) => p.text).join(""),
        parts,
        title: `${file.path} · +${file.additions} −${file.deletions}${isViewed ? " · viewed" : ""}`,
      };
    },
  });

  // Header-owned search: open/close and the input value live in React; the
  // model only does the filtering (setSearch). The model's own search SESSION
  // (openSearch) is deliberately not used — it closes itself when focus isn't
  // inside the tree, and our input lives in the header.
  //
  // setSearch is debounced and focus re-asserted after it fires: a model
  // mutation re-renders the header slot, which remounts the input mid-typing.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applySearch = (value: string) => {
    setSearchValue(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      model.setSearch(value || null);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }, 150);
  };
  const closeSearch = () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    setSearchOpen(false);
    setSearchValue("");
    model.setSearch(null);
  };

  // The tree's shadow-DOM styling comes from OUR tokens, not from a shiki
  // theme. themeToTreeStyles() would hand it GitHub's sidebar palette — close
  // to the app but not the same surface — and it resolves asynchronously, so
  // the first paint used the library's light defaults and flashed white in
  // dark mode. Custom properties inherit through the shadow boundary, so
  // setting them on the host is enough, and it's synchronous.
  const themePreference = useThemeStore((s) => s.preference);
  const isDark = resolveTheme(themePreference) === "future-dark";
  const treeStyles = useMemo(
    () => ({
      colorScheme: isDark ? "dark" : "light",
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
      "--trees-theme-sidebar-bg": "var(--background)",
      "--trees-theme-sidebar-fg": "var(--foreground)",
      "--trees-theme-sidebar-header-fg": "var(--muted-foreground)",
      "--trees-theme-sidebar-border": "var(--border)",
      "--trees-theme-list-hover-bg": "var(--accent)",
      "--trees-theme-list-active-selection-bg": "var(--accent)",
      "--trees-theme-list-active-selection-fg": "var(--accent-foreground)",
      "--trees-theme-focus-ring": "var(--ring)",
      "--trees-theme-input-bg": "var(--input)",
      "--trees-theme-input-border": "var(--border)",
      "--trees-theme-scrollbar-thumb": "var(--muted-foreground)",
      // Git decorations, same greens/reds the row decorations and diff use.
      "--trees-theme-git-added-fg": "var(--color-emerald-500, #10b981)",
      "--trees-theme-git-modified-fg": "var(--muted-foreground)",
      "--trees-theme-git-deleted-fg": "var(--color-red-400, #f87171)",
    }),
    [isDark],
  );

  useEffect(() => {
    onModelReady?.(model);
  }, [model, onModelReady]);

  // Refresh decorations when viewed/agent/file state changes: update the ref,
  // then push a fresh gitStatus array — the mutation re-renders visible rows.
  useEffect(() => {
    stateRef.current = {
      byPath: new Map(files.map((f) => [f.path, f])),
      viewed: new Set(viewedFiles),
      agentPaths,
    };
    model.setGitStatus(gitStatusOf(files));
  }, [model, files, viewedFiles, agentPaths]);

  // External selection (keyboard [ ] / finding clicks) → tree follows.
  //
  // ONE file is selected at a time: the diff shows one file, so a tree with
  // three rows highlighted is just lying. `item.select()` is ADDITIVE, so
  // without clearing first every [ / ] step left the previous file
  // highlighted too.
  const lastExternal = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath || selectedPath === lastExternal.current) return;
    lastExternal.current = selectedPath;
    selectOnly(model, selectedPath, applyingExternal);
  }, [model, selectedPath]);

  const [count] = useState(() => files.length);
  // The search box keeps its state while the column shows something else —
  // it is just not the row's business to render it there.
  const searching = searchOpen && !overlayShown;

  return (
    <div className="h-full min-h-0 flex flex-col" data-tandem-filetree>
      {/* The header is OURS and sits above the tree rather than in the
          library's own `header` slot: it can then hold the column's tab group
          and stay h-9 — the same height as the diff and agent pane headers,
          which is what keeps the three column headers on one line across the
          screen. */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border bg-background shrink-0 min-w-0">
        {searching ? (
          // The search input takes over the header row while open.
          <Input
            autoFocus
            size="xs"
            ref={searchInputRef}
            value={searchValue}
            onChange={(e) => applySearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeSearch();
              }
            }}
            placeholder={`Search ${count} files…`}
            spellCheck={false}
            className="h-6 text-xs font-mono flex-1 min-w-0"
          />
        ) : (
          <>
            {headerAction}
            <span className="flex-1" />
          </>
        )}
        {overlayShown ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="2xs"
                icon
                variant="ghost"
                className="shrink-0"
                aria-label={searching ? "Close file search" : "Search files"}
                onClick={() =>
                  searching ? closeSearch() : setSearchOpen(true)
                }
              >
                {searching ? <X /> : <Search />}
              </Button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>
                {searching ? "Close search" : "Search files"}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        )}
      </div>
      {/* The overlay's positioning parent — and the tree's, so the tree keeps
          its own height while something is drawn over it. */}
      <div id={panelId} role="tabpanel" className="relative flex-1 min-h-0">
        <TreesFileTree
          model={model}
          className="h-full"
          style={treeStyles as React.CSSProperties}
        />
        {overlay}
      </div>
    </div>
  );
}

function gitStatusOf(files: FileChange[]): GitStatusEntry[] {
  return files.map((f) => ({ path: f.path, status: GIT_STATUS[f.status] }));
}
