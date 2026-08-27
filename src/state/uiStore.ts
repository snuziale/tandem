// In-memory UI state (+ a few persisted display prefs). Keyboard handlers
// read this via getState() snapshots (the Sift dispatch pattern) so the global
// keydown listener never re-binds.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Route } from "../routes";
import type { PrId } from "../shared/review-types";

export type QueueRowRef = { prId: PrId; url: string; blockerTitle?: string };
export type DiffStyle = "unified" | "split";
export type ComposerTarget = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
};
/** react-resizable-panels' Layout: panel id → size, in the library's own units. */
export type PaneLayout = Record<string, number>;

type UiState = {
  route: Route;
  setRoute: (route: Route) => void;

  /**
   * The queue's selected view lives in the URL (see routes.ts). This is only a
   * MEMORY of the last one — persisted, so a cold launch and every "← Queue"
   * lands back where the user was. Never read it to decide what's rendered.
   */
  lastViewId: string | null;
  setLastViewId: (id: string | null) => void;

  /**
   * Companion memory for the stats facet, so "← Queue" and `esc` land on the
   * exact queue you left — filter included. Mirrored off every queue route in
   * `setRoute` below, which is the ONE funnel every navigation goes through
   * (navigate(), popstate, and the initial resolve alike).
   *
   * Deliberately NOT persisted, unlike lastViewId: a saved view is a named
   * thing you chose and is fine to relaunch into, a drill-down is transient
   * and would just make a cold launch look mysteriously short.
   */
  lastFacet: string | null;

  focusedPrId: PrId | null;
  setFocusedPr: (id: PrId | null) => void;

  // The active view's visible rows, in render order — published by QueueView
  // so j/k and open/approve know what the keyboard is moving over.
  queueRows: QueueRowRef[];
  setQueueRows: (rows: QueueRowRef[]) => void;

  // Where the line composer is open (one at a time, spec §3.2 line click).
  composerTarget: ComposerTarget | null;
  setComposerTarget: (target: ComposerTarget | null) => void;

  // Finding triage focus/editing on the detail screen (j/k · y/e/x).
  focusedFindingId: string | null;
  setFocusedFinding: (id: string | null) => void;
  editingFindingId: string | null;
  setEditingFinding: (id: string | null) => void;

  // Persisted display prefs.
  diffStyle: DiffStyle;
  setDiffStyle: (style: DiffStyle) => void;

  /** Fold whitespace-only changes out of the diff (`git diff -w`). Persisted
   * like diffStyle: how you read diffs is a working preference. */
  hideWhitespace: boolean;
  setHideWhitespace: (hide: boolean | ((current: boolean) => boolean)) => void;

  /**
   * PR-detail pane widths (files / diff / agent), as react-resizable-panels'
   * own Layout map. PrDetailView remounts per PR (keyed on prId), so the sizes
   * have to live outside it or every navigation snaps back to the defaults.
   * Persisted: a pane width the user dragged is a preference, not per-PR state.
   */
  prPaneLayout: PaneLayout | null;
  setPrPaneLayout: (layout: PaneLayout) => void;

  /**
   * PR-detail side panes. Hiding one hands the whole width to the diff — the
   * review itself is the reason the screen exists. Persisted for the same
   * reason the widths are: it's a working preference, not per-PR state.
   */
  prFilesOpen: boolean;
  prAgentOpen: boolean;
  setPrFilesOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setPrAgentOpen: (open: boolean | ((current: boolean) => boolean)) => void;

  /** The chat section at the foot of the agent pane. Persisted like the panes. */
  prChatOpen: boolean;
  setPrChatOpen: (open: boolean | ((current: boolean) => boolean)) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  // The queue's query row is hidden until its toggle latches on (or `/`).
  queryBarOpen: boolean;
  setQueryBarOpen: (open: boolean | ((current: boolean) => boolean)) => void;

  /** The queue's stats drawer. Persisted — whether you review with the
   * breakdown on screen is a working preference, not per-session state. */
  statsOpen: boolean;
  setStatsOpen: (open: boolean | ((current: boolean) => boolean)) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      route: { name: "queue", viewId: null, facet: null },
      setRoute: (route) =>
        set(
          route.name === "queue"
            ? { route, lastFacet: route.facet }
            : { route },
        ),

      lastViewId: null,
      setLastViewId: (id) => set({ lastViewId: id }),
      lastFacet: null,

      focusedPrId: null,
      setFocusedPr: (id) => set({ focusedPrId: id }),

      queueRows: [],
      setQueueRows: (rows) => set({ queueRows: rows }),

      composerTarget: null,
      setComposerTarget: (target) => set({ composerTarget: target }),

      focusedFindingId: null,
      setFocusedFinding: (id) => set({ focusedFindingId: id }),
      editingFindingId: null,
      setEditingFinding: (id) => set({ editingFindingId: id }),

      diffStyle: "unified",
      setDiffStyle: (style) => set({ diffStyle: style }),

      hideWhitespace: false,
      setHideWhitespace: (hide) =>
        set((s) => ({
          hideWhitespace:
            typeof hide === "function" ? hide(s.hideWhitespace) : hide,
        })),

      prPaneLayout: null,
      setPrPaneLayout: (layout) => set({ prPaneLayout: layout }),

      prFilesOpen: true,
      prAgentOpen: true,
      setPrFilesOpen: (open) =>
        set((s) => ({
          prFilesOpen: typeof open === "function" ? open(s.prFilesOpen) : open,
        })),
      setPrAgentOpen: (open) =>
        set((s) => ({
          prAgentOpen: typeof open === "function" ? open(s.prAgentOpen) : open,
        })),

      prChatOpen: true,
      setPrChatOpen: (open) =>
        set((s) => ({
          prChatOpen: typeof open === "function" ? open(s.prChatOpen) : open,
        })),

      shortcutsOpen: false,
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

      queryBarOpen: false,
      setQueryBarOpen: (open) =>
        set((s) => ({
          queryBarOpen:
            typeof open === "function" ? open(s.queryBarOpen) : open,
        })),

      statsOpen: false,
      setStatsOpen: (open) =>
        set((s) => ({
          statsOpen: typeof open === "function" ? open(s.statsOpen) : open,
        })),
    }),
    {
      name: "tandem:ui:v1",
      version: 1,
      partialize: (s) => ({
        diffStyle: s.diffStyle,
        hideWhitespace: s.hideWhitespace,
        lastViewId: s.lastViewId,
        prPaneLayout: s.prPaneLayout,
        prFilesOpen: s.prFilesOpen,
        prAgentOpen: s.prAgentOpen,
        prChatOpen: s.prChatOpen,
        statsOpen: s.statsOpen,
      }),
    },
  ),
);
