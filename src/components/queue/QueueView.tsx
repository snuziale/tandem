import { useEffect, useState } from 'react';
import { useQueue } from '../../hooks/useQueue';
import { useSavedViews, useSaveViews } from '../../hooks/useSavedViews';
import type { SavedView } from '../../shared/review-types';
import { useUiStore } from '../../state/uiStore';
import { TopBar } from '../layout/TopBar';
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

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <TopBar />
      <ViewTabs
        views={views ?? []}
        counts={queue.data?.counts ?? {}}
        activeViewId={activeViewId}
        onSelect={(id) => setActiveView(id)}
        onAddView={() => setEditor({ mode: 'new' })}
        onOpenJson={() => setJsonOpen(true)}
      />
      {activeView ? (
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
