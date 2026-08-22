import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Markdown } from '../common/Markdown';

export function DescriptionCollapse({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  // PR templates ship as HTML comments — a body that is only comments is empty.
  const trimmed = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!trimmed) return null;
  const paragraphs = trimmed.split(/\n{2,}/).length;

  return (
    <div className="border-b border-border px-4 py-1.5 max-h-[45dvh] overflow-y-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono hover:text-foreground"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Description · {paragraphs} paragraph{paragraphs === 1 ? '' : 's'}
      </button>
      {open ? (
        // Centered at a readable measure — long descriptions read like a page,
        // not a full-width smear.
        <div className="w-full">
          <Markdown className="mt-3 mb-3 max-w-[76ch] mx-auto">{trimmed}</Markdown>
        </div>
      ) : null}
    </div>
  );
}
