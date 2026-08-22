import { Plus } from 'lucide-react';
import { Button, Tabs, TabsList, TabsTrigger } from '@uipath/apollo-wind';
import type { SavedView } from '../../shared/review-types';

type Props = {
  views: SavedView[];
  counts: Record<string, number>;
  activeViewId: string | null;
  onSelect: (id: string) => void;
  onAddView: () => void;
};

/** Row content only — the queue's merged header owns the chrome around it. */
export function ViewTabs({ views, counts, activeViewId, onSelect, onAddView }: Props) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      {views.length > 0 ? (
        <Tabs value={activeViewId ?? undefined} onValueChange={onSelect} className="min-w-0">
          <TabsList className="max-w-full overflow-x-auto">
            {views.map((view) => (
              <TabsTrigger key={view.id} value={view.id} className="font-mono text-xs gap-1.5">
                <span className="truncate max-w-40" title={view.name}>
                  {view.name}
                </span>
                {counts[view.id] !== undefined ? <span className="text-[10px] text-muted-foreground">{counts[view.id]}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      <Button size="2xs" icon variant="ghost" aria-label="New view" onClick={onAddView}>
        <Plus />
      </Button>
    </div>
  );
}
