import { useState } from 'react';
import { Button, Checkbox, Label, Textarea } from '@uipath/apollo-wind';
import type { ComposerTarget } from '../../state/uiStore';

type Props = {
  target: ComposerTarget;
  onSubmit: (body: string, suggestion?: string) => void;
  onCancel: () => void;
};

// The line composer, opened by clicking a diff line. ⌘↵ stages, Esc closes.
export function ComposerCard({ target, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState('');
  const [isSuggestion, setIsSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState('');

  const canSubmit = body.trim().length > 0 || (isSuggestion && suggestion.length > 0);
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(body.trim(), isSuggestion ? suggestion : undefined);
  };

  return (
    <div className="my-1 mx-2 rounded border border-primary/40 bg-background p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
        Comment on {target.path.split('/').pop()}:{target.line}
        {target.side === 'LEFT' ? ' (old side)' : ''}
      </div>
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Leave a comment…"
        className="min-h-16 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <Checkbox id="composer-suggestion" checked={isSuggestion} onCheckedChange={(v) => setIsSuggestion(v === true)} className="size-3.5" />
        <Label htmlFor="composer-suggestion" className="text-xs text-muted-foreground">
          Include a suggested change (exact replacement for this line)
        </Label>
      </div>
      {isSuggestion ? (
        <Textarea
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          placeholder="Replacement text for the anchored line(s)…"
          className="min-h-12 text-sm font-mono"
          spellCheck={false}
        />
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!canSubmit} onClick={submit}>
          Add to review
        </Button>
      </div>
    </div>
  );
}
