// In-memory UI state. Keyboard handlers read this via getState() snapshots
// (the Sift dispatch pattern) so the global keydown listener never re-binds.
import { create } from 'zustand';
import type { PrId } from '../shared/review-types';

export type QueueRowRef = { prId: PrId; url: string };

type UiState = {
  activeViewId: string | null;
  setActiveView: (id: string | null) => void;

  focusedPrId: PrId | null;
  setFocusedPr: (id: PrId | null) => void;

  // The active view's visible rows, in render order — published by QueueView
  // so j/k and open/approve know what the keyboard is moving over.
  queueRows: QueueRowRef[];
  setQueueRows: (rows: QueueRowRef[]) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>()((set) => ({
  activeViewId: null,
  setActiveView: (id) => set({ activeViewId: id }),

  focusedPrId: null,
  setFocusedPr: (id) => set({ focusedPrId: id }),

  queueRows: [],
  setQueueRows: (rows) => set({ queueRows: rows }),

  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
}));
