// Global keyboard dispatch, Sift pattern: one window keydown listener bound
// once; frequently-changing state read via getState() snapshots at dispatch
// time; handlers are plain functions over a ctx object. Keys that must work
// inside a dialog are bound in that dialog, never here (the guard chain bails
// when any dialog is open).
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { hasOpenDialog, isTypingTarget } from "../keyboard/target";
import { navigate } from "../routes";
import { parsePrId } from "../shared/gh/prKey";
import { useUiStore } from "../state/uiStore";
import { approvePrAction, openPrExternal } from "../actions/queue";

export function openPrDetail(prId: string): void {
  const ref = parsePrId(prId);
  if (!ref) return;
  navigate({ name: "pr", ...ref, prId });
}

type NavCtx = {
  e: KeyboardEvent;
  queryClient: QueryClient;
};

function moveFocus(delta: 1 | -1): void {
  const { queueRows, focusedPrId, setFocusedPr } = useUiStore.getState();
  if (queueRows.length === 0) return;
  const idx = queueRows.findIndex((r) => r.prId === focusedPrId);
  const next =
    idx === -1
      ? delta === 1
        ? 0
        : queueRows.length - 1
      : Math.min(queueRows.length - 1, Math.max(0, idx + delta));
  setFocusedPr(queueRows[next].prId);
  document
    .querySelector(`[data-pr-row="${CSS.escape(queueRows[next].prId)}"]`)
    ?.scrollIntoView({ block: "nearest" });
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
  // Guard rail, not a block (spec §3.1): 'a' refuses while the agent has an
  // open blocker; shift+A overrides deliberately.
  a: (ctx) => {
    const row = focusedRow();
    if (!row) return;
    ctx.e.preventDefault();
    if (row.blockerTitle) {
      toast.warning(`Agent found a blocker: ${row.blockerTitle}`, {
        description: "shift+A approves anyway.",
      });
      return;
    }
    void approvePrAction(ctx.queryClient, row.prId);
  },
  A: (ctx) => {
    const row = focusedRow();
    if (!row) return;
    ctx.e.preventDefault();
    void approvePrAction(ctx.queryClient, row.prId);
  },
  r: (ctx) => {
    ctx.e.preventDefault();
    void ctx.queryClient.invalidateQueries({ queryKey: ["queue"] });
  },
  // The breakdown drawer. A facet in the URL forces it open (QueueView), so
  // closing it has to clear the facet too — otherwise the table stays short
  // with nothing on screen saying why.
  s: (ctx) => {
    ctx.e.preventDefault();
    const { route, statsOpen, setStatsOpen } = useUiStore.getState();
    const facet = route.name === "queue" ? route.facet : null;
    if (statsOpen || facet) {
      setStatsOpen(false);
      if (facet)
        navigate({
          name: "queue",
          viewId: route.name === "queue" ? route.viewId : null,
          facet: null,
        });
    } else setStatsOpen(true);
  },
  // Esc drops the facet without closing the breakdown — the common "show me
  // everything again" move.
  Escape: (ctx) => {
    const { route } = useUiStore.getState();
    if (route.name !== "queue" || !route.facet) return;
    ctx.e.preventDefault();
    navigate({ name: "queue", viewId: route.viewId, facet: null });
  },
  "/": (ctx) => {
    ctx.e.preventDefault();
    // The query row hides until latched — `/` latches it, then focuses.
    useUiStore.getState().setQueryBarOpen(true);
    requestAnimationFrame(() => {
      const input = document.getElementById("queue-query-input");
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
  },
};

export function useKeyboardNav(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hasOpenDialog()) return;
      if (isTypingTarget(e.target)) {
        // Esc blurs the field rather than doing anything destructive.
        if (e.key === "Escape" && e.target instanceof HTMLElement)
          e.target.blur();
        return;
      }
      // `?` works on every screen; everything else here is queue-scoped
      // (the PR detail screen binds its own keys).
      if (e.key === "?") {
        e.preventDefault();
        useUiStore.getState().setShortcutsOpen(true);
        return;
      }
      if (useUiStore.getState().route.name !== "queue") return;
      // Cheap gate before any store reads — most keys are handled by nobody.
      if (!Object.hasOwn(QUEUE_HANDLERS, e.key)) return;
      QUEUE_HANDLERS[e.key]({ e, queryClient });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queryClient]);
}
