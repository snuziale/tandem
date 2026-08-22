import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function DescriptionCollapse({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = body.trim();
  if (!trimmed) return null;
  const paragraphs = trimmed.split(/\n{2,}/).length;

  return (
    <div className="border-b border-border px-4 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono hover:text-foreground"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Description · {paragraphs} paragraph{paragraphs === 1 ? '' : 's'}
      </button>
      {open ? <div className="text-sm mt-2 mb-1 max-w-[72ch] whitespace-pre-wrap break-words">{trimmed}</div> : null}
    </div>
  );
}
