// In-memory UI state (+ a few persisted display prefs). Keyboard handlers
// read this via getState() snapshots (the Sift dispatch pattern) so the global
// keydown listener never re-binds.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Route } from '../routes';
import type { PrId } from '../shared/review-types';

export type QueueRowRef = { prId: PrId; url: string; blockerTitle?: string };
export type DiffStyle = 'unified' | 'split';
export type ComposerTarget = { path: string; line: number; side: 'LEFT' | 'RIGHT' };

type UiState = {
  route: Route;
  setRoute: (route: Route) => void;

  activeViewId: string | null;
  setActiveView: (id: string | null) => void;

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

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  // The queue's query row is hidden until its toggle latches on (or `/`).
  queryBarOpen: boolean;
  setQueryBarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      route: { name: 'queue' },
      setRoute: (route) => set({ route }),

      activeViewId: null,
      setActiveView: (id) => set({ activeViewId: id }),

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

      diffStyle: 'unified',
      setDiffStyle: (style) => set({ diffStyle: style }),

      shortcutsOpen: false,
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

      queryBarOpen: false,
      setQueryBarOpen: (open) => set((s) => ({ queryBarOpen: typeof open === 'function' ? open(s.queryBarOpen) : open })),
    }),
    {
      name: 'tandem:ui:v1',
      version: 1,
      partialize: (s) => ({ diffStyle: s.diffStyle }),
    }
  )
);
