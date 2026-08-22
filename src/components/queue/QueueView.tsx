import { useEffect } from 'react';
import { useQueue } from '../../hooks/useQueue';
import { useSavedViews, useSaveViews } from '../../hooks/useSavedViews';
import { useUiStore } from '../../state/uiStore';
import { TopBar } from '../layout/TopBar';
import { QueryBar } from './QueryBar';
import { QueueTable } from './QueueTable';
import { ViewTabs } from './ViewTabs';

export function QueueView() {
  const viewsQuery = useSavedViews();
  const saveViews = useSaveViews();
  const views = viewsQuery.data;

  const activeViewId = useUiStore((s) => s.activeViewId);
  const setActiveView = useUiStore((s) => s.setActiveView);

  useEffect(() => {
    if (views?.length && (!activeViewId || !views.some((v) => v.id === activeViewId))) {
      setActiveView(views[0].id);
    }
  }, [views, activeViewId, setActiveView]);

  const queue = useQueue(views);
  const activeView = views?.find((v) => v.id === activeViewId);
  const rows = activeViewId ? queue.data?.views[activeViewId] : undefined;

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <TopBar />
      <ViewTabs
        views={views ?? []}
        counts={queue.data?.counts ?? {}}
        activeViewId={activeViewId}
        onSelect={(id) => setActiveView(id)}
      />
      {activeView ? (
        <QueryBar
          query={activeView.query}
          onCommit={(query) => {
            if (!views) return;
            saveViews.mutate(views.map((v) => (v.id === activeView.id ? { ...v, query } : v)));
          }}
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
    </div>
  );
}
