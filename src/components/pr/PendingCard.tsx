import { useState } from 'react';
import { Button, Textarea, cn } from '@uipath/apollo-wind';
import { Pencil, Trash2 } from 'lucide-react';
import type { PendingComment } from '../../shared/review-types';

type Props = {
  comment: PendingComment;
  onUpdate: (patch: Partial<PendingComment>) => void;
  onRemove: () => void;
};

// A comment staged in the local pending review, rendered inline at its anchor.
// Nothing on GitHub yet — the tray's Submit posts all of these as one review.
export function PendingCard({ comment, onUpdate, onRemove }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const agentAuthored = comment.findingId !== undefined;

  return (
    <div
      className={cn('my-1 mx-2 rounded border border-border bg-background border-l-2', comment.anchorMoved && 'border-yellow-400/60')}
      style={{ borderLeftColor: agentAuthored ? 'var(--tandem-agent)' : 'var(--color-primary)' }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          <span style={agentAuthored ? { color: 'var(--tandem-agent)' } : undefined}>
            {agentAuthored ? 'agent · staged' : 'your comment · staged'}
          </span>
          {comment.anchorMoved ? <span className="text-yellow-400">anchor moved — fix before submit</span> : null}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" aria-label="Edit" onClick={() => setEditing((v) => !v)}>
            <Pencil className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" aria-label="Remove from review" onClick={onRemove}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onUpdate({ body: draft });
                setEditing(false);
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(comment.body);
                setEditing(false);
              }
            }}
            onBlur={() => {
              onUpdate({ body: draft });
              setEditing(false);
            }}
            className="mt-1 min-h-14 text-sm font-mono"
          />
        ) : (
          <div className="text-sm mt-1 whitespace-pre-wrap break-words">{comment.body}</div>
        )}
        {comment.suggestion !== undefined ? (
          <pre className="mt-2 text-xs font-mono border border-border rounded p-2 overflow-x-auto bg-accent/30">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">suggested change</div>
            {comment.suggestion}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
