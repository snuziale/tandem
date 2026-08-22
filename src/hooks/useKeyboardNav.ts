// Global keyboard dispatch, Sift pattern: one window keydown listener bound
// once; frequently-changing state read via getState() snapshots at dispatch
// time; handlers are plain functions over a ctx object. Keys that must work
// inside a dialog are bound in that dialog, never here (the guard chain bails
// when any dialog is open).
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { hasOpenDialog, isTypingTarget } from '../keyboard/target';
import { navigate } from '../routes';
import { parsePrId } from '../shared/gh/prKey';
import { useUiStore } from '../state/uiStore';
import { approvePrAction, openPrExternal } from './queueActions';

export function openPrDetail(prId: string): void {
  const ref = parsePrId(prId);
  if (!ref) return;
  navigate({ name: 'pr', ...ref, prId });
}

type NavCtx = {
  e: KeyboardEvent;
  queryClient: QueryClient;
};

function moveFocus(delta: 1 | -1): void {
  const { queueRows, focusedPrId, setFocusedPr } = useUiStore.getState();
  if (queueRows.length === 0) return;
  const idx = queueRows.findIndex((r) => r.prId === focusedPrId);
  const next = idx === -1 ? (delta === 1 ? 0 : queueRows.length - 1) : Math.min(queueRows.length - 1, Math.max(0, idx + delta));
  setFocusedPr(queueRows[next].prId);
  document.querySelector(`[data-pr-row="${CSS.escape(queueRows[next].prId)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function focusedRow() {
  const { queueRows, focusedPrId } = useUiStore.getState();
  return queueRows.find((r) => r.prId === focusedPrId) ?? null;
}

const QUEUE_HANDLERS: Record<string, (ctx: NavCtx) => void> = {
  j: (ctx) => {
    ctx.e.preventDefault();
    moveFocus(1);
  },
  ArrowDown: (ctx) => QUEUE_HANDLERS.j(ctx),
  k: (ctx) => {
    ctx.e.preventDefault();
    moveFocus(-1);
  },
  ArrowUp: (ctx) => QUEUE_HANDLERS.k(ctx),
  o: (ctx) => {
    const row = focusedRow();
    if (!row) return;
    ctx.e.preventDefault();
    openPrExternal(row.url);
  },
  Enter: (ctx) => {
    const row = focusedRow();
    if (!row) return;
    ctx.e.preventDefault();
    openPrDetail(row.prId);
  },
  a: (ctx) => {
    const row = focusedRow();
    if (!row) return;
    ctx.e.preventDefault();
    void approvePrAction(ctx.queryClient, row.prId);
  },
  r: (ctx) => {
    ctx.e.preventDefault();
    void ctx.queryClient.invalidateQueries({ queryKey: ['queue'] });
  },
  '/': (ctx) => {
    const input = document.getElementById('queue-query-input');
    if (!(input instanceof HTMLInputElement)) return;
    ctx.e.preventDefault();
    input.focus();
    input.select();
  },
};

export function useKeyboardNav(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // These are the QUEUE keys; the PR detail screen binds its own.
      if (useUiStore.getState().route.name !== 'queue') return;
      if (hasOpenDialog()) return;
      if (isTypingTarget(e.target)) {
        // Esc blurs the field rather than doing anything destructive.
        if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
        return;
      }
      // Cheap gate before any store reads — most keys are handled by nobody.
      if (!Object.hasOwn(QUEUE_HANDLERS, e.key)) return;
      QUEUE_HANDLERS[e.key]({ e, queryClient });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queryClient]);
}
