import { cn } from '@uipath/apollo-wind';
import type { SavedView } from '../../shared/review-types';

type Props = {
  views: SavedView[];
  counts: Record<string, number>;
  activeViewId: string | null;
  onSelect: (id: string) => void;
};

export function ViewTabs({ views, counts, activeViewId, onSelect }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border">
      {views.map((view) => {
        const active = view.id === activeViewId;
        const count = counts[view.id];
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelect(view.id)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded font-mono',
              active ? 'bg-accent text-foreground border border-primary/30' : 'text-muted-foreground hover:bg-accent/40'
            )}
          >
            <span className="truncate max-w-40" title={view.name}>
              {view.name}
            </span>
            {count !== undefined ? <span className={cn('text-[10px]', active ? 'text-muted-foreground' : '')}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
