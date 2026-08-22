import { useEffect, useState } from 'react';
import { Button, Input } from '@uipath/apollo-wind';
import { Pencil } from 'lucide-react';
import type { RateLimitInfo } from '../../shared/review-types';
import { refreshAge } from '../../utils/time';

type Props = {
  query: string;
  onCommit: (query: string) => void;
  onEditView: () => void;
  rateLimit: RateLimitInfo | null;
  dataUpdatedAt: number;
};

// The raw GitHub search query, always visible and editable (spec §3.1) — the
// user should never wonder what they're looking at. Enter commits, Esc reverts.
export function QueryBar({ query, onCommit, onEditView, rateLimit, dataUpdatedAt }: Props) {
  const [draft, setDraft] = useState(query);
  // Reset the draft when the committed query changes from outside (view
  // switch, save round-trip) — render-time adjustment, not an effect.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  // Ticks the "refreshed Ns ago" label without waiting for a data change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono shrink-0">query</span>
      <Input
        id="queue-query-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim() && draft !== query) onCommit(draft.trim());
          if (e.key === 'Escape') setDraft(query);
        }}
        spellCheck={false}
        className="h-7 font-mono text-xs flex-1"
      />
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-label="Edit this view" onClick={onEditView}>
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <span className="text-[11px] text-muted-foreground font-mono shrink-0">
        {rateLimit ? `GraphQL ${rateLimit.remaining}/${rateLimit.limit} · ` : ''}
        {refreshAge(dataUpdatedAt, now)}
      </span>
    </div>
  );
}
