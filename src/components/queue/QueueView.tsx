import { useState } from "react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import { Braces } from "lucide-react";
import { useActiveView } from "../../hooks/useActiveView";
import { useQueue } from "../../hooks/useQueue";
import { useSavedViews, useViewActions } from "../../hooks/useSavedViews";
import type { SavedView } from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import { AppHeader } from "../layout/AppHeader";
import { QueryBar } from "./QueryBar";
import { QueueTable } from "./QueueTable";
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

  // Selection is URL state; every list write goes through one action set.
  const { activeViewId, activeView } = useActiveView(views);
  const actions = useViewActions(views, activeViewId);

  const queue = useQueue(views);
  const rows = activeViewId ? queue.data?.views[activeViewId] : undefined;

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

      <QueueTable
        rows={rows}
        isLoading={queue.isPending && !!views?.length}
        error={queue.error}
        viewError={activeViewId ? queue.data?.errors[activeViewId] : undefined}
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
