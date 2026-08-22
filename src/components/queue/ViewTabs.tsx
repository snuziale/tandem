import { Braces, Plus } from 'lucide-react';
import { Button, Tabs, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@uipath/apollo-wind';
import type { SavedView } from '../../shared/review-types';

type Props = {
  views: SavedView[];
  counts: Record<string, number>;
  activeViewId: string | null;
  onSelect: (id: string) => void;
  onAddView: () => void;
  onOpenJson: () => void;
};

/** Row content only — the queue's merged header owns the chrome around it. */
export function ViewTabs({ views, counts, activeViewId, onSelect, onAddView, onOpenJson }: Props) {
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
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground shrink-0" onClick={onAddView}>
        <Plus className="w-3.5 h-3.5 mr-1" /> view
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground shrink-0"
            aria-label="Views as JSON"
            onClick={onOpenJson}
          >
            <Braces className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>View / export / import the views as JSON</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </div>
  );
}
