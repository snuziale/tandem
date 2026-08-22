import { Tabs, TabsList, TabsTrigger } from '@uipath/apollo-wind';
import type { SavedView } from '../../shared/review-types';

type Props = {
  views: SavedView[];
  counts: Record<string, number>;
  activeViewId: string | null;
  onSelect: (id: string) => void;
};

export function ViewTabs({ views, counts, activeViewId, onSelect }: Props) {
  if (views.length === 0) return <div className="border-b border-border h-9" />;
  return (
    <div className="px-4 py-1 border-b border-border">
      <Tabs value={activeViewId ?? undefined} onValueChange={onSelect}>
        <TabsList>
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
    </div>
  );
}
