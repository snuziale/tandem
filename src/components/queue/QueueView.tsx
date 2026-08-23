import { useMemo, useState } from "react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import { Braces, ChartNoAxesColumn } from "lucide-react";
import { useActiveView } from "../../hooks/useActiveView";
import { useNow } from "../../hooks/useNow";
import { useQueue } from "../../hooks/useQueue";
import { useSavedViews, useViewActions } from "../../hooks/useSavedViews";
import { navigate } from "../../routes";
import type { SavedView } from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import {
  facetLabel,
  filterByFacet,
  formatFacet,
  parseFacet,
  type Facet,
} from "../../utils/queueStats";
import { AppHeader } from "../layout/AppHeader";
import { QueryBar } from "./QueryBar";
import { QueueTable } from "./QueueTable";
import { StatsDrawer } from "./StatsDrawer";
import {
  DeleteViewDialog,
  ViewEditorDialog,
  ViewsJsonDialog,
} from "./ViewDialogs";
import { ViewTabs } from "./ViewTabs";

type EditorState =
  { mode: "closed" } | { mode: "new" } | { mode: "edit"; view: SavedView };

export function QueueView() {
  const viewsQuery = useSavedViews();
  const views = viewsQuery.data;

  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  const queryBarOpen = useUiStore((s) => s.queryBarOpen);
  const setQueryBarOpen = useUiStore((s) => s.setQueryBarOpen);
  const statsOpen = useUiStore((s) => s.statsOpen);
  const setStatsOpen = useUiStore((s) => s.setStatsOpen);
  const route = useUiStore((s) => s.route);
  const now = useNow();

  // Selection is URL state; every list write goes through one action set.
  const { activeViewId, activeView } = useActiveView(views);
  const actions = useViewActions(views, activeViewId);

  const queue = useQueue(views);
  // The view's whole result set — the stats drawer's denominator, and what the
  // facet narrows for the table.
  const allRows = activeViewId ? queue.data?.views[activeViewId] : undefined;

  // A facet only makes sense with the breakdown that produced it on screen, so
  // a facet in the URL implies an open drawer (and closing the drawer clears
  // it) — the table is never mysteriously short.
  const facetRaw = route.name === "queue" ? route.facet : null;
  const facet = useMemo(() => parseFacet(facetRaw), [facetRaw]);
  const statsShown = statsOpen || facet !== null;
  const setFacet = (next: Facet | null) =>
    navigate({
      name: "queue",
      viewId: activeViewId,
      facet: formatFacet(next),
    });
  const rows = useMemo(
    () => (allRows ? filterByFacet(allRows, facet, now) : undefined),
    [allRows, facet, now],
  );

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <AppHeader
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="xs"
                icon
                variant="ghost"
                aria-label="Views as JSON"
                onClick={() => setJsonOpen(true)}
              >
                <Braces />
              </Button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>
                View / export / import the views as JSON
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        }
      >
        <ViewTabs
          views={views ?? []}
          counts={queue.data?.counts ?? {}}
          activeViewId={activeViewId}
          onSelect={actions.select}
          onRename={actions.rename}
          onDuplicate={actions.duplicate}
          onDelete={setDeleting}
          onEdit={(view) => setEditor({ mode: "edit", view })}
          onAddView={() => setEditor({ mode: "new" })}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="xs"
              icon
              variant="ghost"
              aria-label="Queue breakdown"
              aria-pressed={statsShown}
              className={cn(statsShown && "text-foreground bg-accent")}
              onClick={() => {
                if (statsShown) {
                  setStatsOpen(false);
                  if (facet) setFacet(null);
                } else setStatsOpen(true);
              }}
            >
              <ChartNoAxesColumn />
            </Button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>
              {statsShown ? "Hide" : "Show"} the breakdown of this view (s)
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Named, not iconified: no glyph says "the raw GitHub search string"
                as plainly as the word does — and it matches the row's own label. */}
            <Button
              size="2xs"
              variant="ghost"
              aria-pressed={queryBarOpen}
              aria-label="Show the view's raw query"
              className={cn(
                "font-mono text-[11px] px-1.5",
                queryBarOpen
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground",
              )}
              onClick={() => setQueryBarOpen((o) => !o)}
            >
              query
            </Button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>
              {queryBarOpen ? "Hide" : "Show / edit"} the view's raw query (/)
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </AppHeader>

      {queryBarOpen && activeView ? (
        <QueryBar
          query={activeView.query}
          onCommit={(query) =>
            actions.replaceAll(
              (views ?? []).map((v) =>
                v.id === activeView.id ? { ...v, query } : v,
              ),
            )
          }
          onEditView={() => setEditor({ mode: "edit", view: activeView })}
          rateLimit={queue.data?.rateLimit ?? null}
          dataUpdatedAt={queue.dataUpdatedAt}
        />
      ) : null}

      {statsShown ? (
        <StatsDrawer
          rows={allRows}
          shownCount={rows?.length ?? 0}
          matching={activeViewId ? queue.data?.counts[activeViewId] : undefined}
          now={now}
          facet={facet}
          onFacet={setFacet}
        />
      ) : null}

      <QueueTable
        rows={rows}
        isLoading={queue.isPending && !!views?.length}
        error={queue.error}
        viewError={activeViewId ? queue.data?.errors[activeViewId] : undefined}
        filteredBy={
          facet && allRows?.length
            ? { label: facetLabel(facet), onClear: () => setFacet(null) }
            : undefined
        }
      />

      {editor.mode !== "closed" ? (
        <ViewEditorDialog
          // Keyed so switching between "new" and each view resets the fields.
          key={editor.mode === "edit" ? editor.view.id : "new"}
          view={editor.mode === "edit" ? editor.view : null}
          open
          onClose={() => setEditor({ mode: "closed" })}
          onSave={actions.upsert}
        />
      ) : null}
      {deleting ? (
        <DeleteViewDialog
          view={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => actions.remove(deleting.id)}
        />
      ) : null}
      {jsonOpen ? (
        <ViewsJsonDialog
          views={views ?? []}
          open
          onClose={() => setJsonOpen(false)}
          onApply={actions.replaceAll}
        />
      ) : null}
    </div>
  );
}
