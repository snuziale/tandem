import { useMemo, useState } from "react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import { ChartNoAxesColumn } from "lucide-react";
import { useActiveView } from "../../hooks/useActiveView";
import { useNow } from "../../hooks/useNow";
import { usePulseOptions } from "../../hooks/usePulse";
import { useQueue } from "../../hooks/useQueue";
import { useTeamActions, useTeams } from "../../hooks/useTeams";
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
import { AppHeader, HeaderDivider } from "../layout/AppHeader";
import { PulsePill } from "./PulsePill";
import { QueryBar } from "./QueryBar";
import { QueueTable } from "./QueueTable";
import { TeamManagerDialog } from "./TeamDialogs";
import { StatsDrawer } from "./StatsDrawer";
import { DeleteViewDialog, ViewEditorDialog } from "./ViewDialogs";
import { ViewTabs } from "./ViewTabs";
import { Shortcut } from "../common/Kbd";

type EditorState =
  { mode: "closed" } | { mode: "new" } | { mode: "edit"; view: SavedView };

export function QueueView() {
  const viewsQuery = useSavedViews();
  const views = viewsQuery.data;
  const teamsQuery = useTeams();
  const teams = teamsQuery.data;
  const teamActions = useTeamActions(teams);

  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);

  const queryBarOpen = useUiStore((s) => s.queryBarOpen);
  const setQueryBarOpen = useUiStore((s) => s.setQueryBarOpen);
  const statsOpen = useUiStore((s) => s.statsOpen);
  const setStatsOpen = useUiStore((s) => s.setStatsOpen);
  const route = useUiStore((s) => s.route);
  const now = useNow();
  // One source of viewer + staleness line, so the table cell, the drawer, the
  // header pill and the menu-bar feed can never disagree about what a state
  // means (shared/pulse.ts).
  const pulseOpts = usePulseOptions(now);

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
    () => (allRows ? filterByFacet(allRows, facet, now, pulseOpts) : undefined),
    [allRows, facet, now, pulseOpts],
  );

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <AppHeader>
        <ViewTabs
          views={views ?? []}
          counts={queue.data?.counts ?? {}}
          shards={queue.data?.shards ?? {}}
          activeViewId={activeViewId}
          onSelect={actions.select}
          onRename={actions.rename}
          onDuplicate={actions.duplicate}
          onDelete={setDeleting}
          onEdit={(view) => setEditor({ mode: "edit", view })}
          onAddView={() => setEditor({ mode: "new" })}
        />
        {/* Everything past this divider is about the ACTIVE VIEW and never
            moves: the tab strip above absorbs all the slack and scrolls
            sideways on its own, so these controls keep the same position
            whether there are two views or twelve. */}
        <HeaderDivider />
        <PulsePill
          rows={allRows}
          opts={pulseOpts}
          facet={facet}
          onFacet={setFacet}
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
              {statsShown ? "Hide" : "Show"} the breakdown of this view
              <Shortcut keys="s" className="ml-1.5" />
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
              {queryBarOpen ? "Hide" : "Show / edit"} the view's raw query
              <Shortcut keys="/" className="ml-1.5" />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </AppHeader>

      {queryBarOpen && activeView ? (
        <QueryBar
          query={activeView.query}
          team={
            activeView.teamId
              ? (teams?.find((t) => t.id === activeView.teamId) ?? null)
              : null
          }
          shards={activeViewId ? queue.data?.shards[activeViewId] : undefined}
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
          viewId={activeViewId}
          pulseOpts={pulseOpts}
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
        pulseOpts={pulseOpts}
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
          teams={teams ?? []}
          open
          onClose={() => setEditor({ mode: "closed" })}
          onSave={actions.upsert}
          onManageTeams={() => setTeamsOpen(true)}
        />
      ) : null}
      {deleting ? (
        <DeleteViewDialog
          view={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => actions.remove(deleting.id)}
        />
      ) : null}
      {teamsOpen ? (
        <TeamManagerDialog
          teams={teams ?? []}
          onClose={() => setTeamsOpen(false)}
          onSave={teamActions.upsert}
          onDelete={teamActions.remove}
        />
      ) : null}
    </div>
  );
}
