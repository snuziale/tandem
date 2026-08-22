import { useEffect, useState } from 'react';
import { Button, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@uipath/apollo-wind';
import { Braces, SlidersHorizontal, X } from 'lucide-react';
import { useQueue } from '../../hooks/useQueue';
import { useSavedViews, useSaveViews } from '../../hooks/useSavedViews';
import type { SavedView } from '../../shared/review-types';
import { useUiStore } from '../../state/uiStore';
import { BrandMark, TopBarActions } from '../layout/TopBar';
import { QueryBar } from './QueryBar';
import { QueueTable } from './QueueTable';
import { ViewEditorDialog, ViewsJsonDialog } from './ViewDialogs';
import { ViewTabs } from './ViewTabs';

type EditorState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; view: SavedView };

export function QueueView() {
  const viewsQuery = useSavedViews();
  const saveViews = useSaveViews();
  const views = viewsQuery.data;

  const activeViewId = useUiStore((s) => s.activeViewId);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [jsonOpen, setJsonOpen] = useState(false);

  const savePending = saveViews.isPending;
  useEffect(() => {
    // While a save is in flight `views` is stale — resetting against it would
    // bounce the selection off a just-created view.
    if (savePending) return;
    if (views?.length && (!activeViewId || !views.some((v) => v.id === activeViewId))) {
      setActiveView(views[0].id);
    }
  }, [views, activeViewId, setActiveView, savePending]);

  const queue = useQueue(views);
  const activeView = views?.find((v) => v.id === activeViewId);
  const rows = activeViewId ? queue.data?.views[activeViewId] : undefined;

  const upsertView = (view: SavedView) => {
    const current = views ?? [];
    const exists = current.some((v) => v.id === view.id);
    saveViews.mutate(exists ? current.map((v) => (v.id === view.id ? view : v)) : [...current, view]);
    setActiveView(view.id);
  };

  const deleteView = (id: string) => {
    const remaining = (views ?? []).filter((v) => v.id !== id);
    saveViews.mutate(remaining);
    if (activeViewId === id) setActiveView(remaining[0]?.id ?? null);
  };

  const queryBarOpen = useUiStore((s) => s.queryBarOpen);
  const setQueryBarOpen = useUiStore((s) => s.setQueryBarOpen);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      {/* One header row: brand · view tabs · query toggle · agent/settings/theme. */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
        <BrandMark />
        <ViewTabs
          views={views ?? []}
          counts={queue.data?.counts ?? {}}
          activeViewId={activeViewId}
          onSelect={(id) => setActiveView(id)}
          onAddView={() => setEditor({ mode: 'new' })}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="2xs" icon variant="ghost" aria-label="Show the view's raw query" onClick={() => setQueryBarOpen((o) => !o)}>
              {queryBarOpen ? <X /> : <SlidersHorizontal />}
            </Button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>{queryBarOpen ? 'Hide' : 'Show / edit'} the view's raw query (/)</TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <div className="flex-1" />
        <TopBarActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="2xs" icon variant="ghost" aria-label="Views as JSON" onClick={() => setJsonOpen(true)}>
                <Braces />
              </Button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>View / export / import the views as JSON</TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </TopBarActions>
      </header>
      {queryBarOpen && activeView ? (
        <QueryBar
          query={activeView.query}
          onCommit={(query) => {
            if (!views) return;
            saveViews.mutate(views.map((v) => (v.id === activeView.id ? { ...v, query } : v)));
          }}
          onEditView={() => setEditor({ mode: 'edit', view: activeView })}
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

      {editor.mode !== 'closed' ? (
        <ViewEditorDialog
          // Keyed so switching between "new" and each view resets the fields.
          key={editor.mode === 'edit' ? editor.view.id : 'new'}
          view={editor.mode === 'edit' ? editor.view : null}
          open
          onClose={() => setEditor({ mode: 'closed' })}
          onSave={upsertView}
          onDelete={deleteView}
        />
      ) : null}
      {jsonOpen ? (
        <ViewsJsonDialog views={views ?? []} open onClose={() => setJsonOpen(false)} onApply={(next) => saveViews.mutate(next)} />
      ) : null}
    </div>
  );
}
