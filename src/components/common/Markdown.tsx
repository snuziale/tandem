import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@uipath/apollo-wind';

// The one markdown renderer: PR descriptions, thread comments, finding bodies,
// staged comments. react-markdown builds a React tree (no innerHTML), so
// GitHub-sourced content stays inert; skipHtml drops raw HTML nodes and we
// strip <!-- comments --> up front (PR templates are full of them). Styles
// live under `.tandem-md` in index.css — compact, review-density typography.
export function Markdown({ children, className }: { children: string; className?: string }) {
  const cleaned = useMemo(() => children.replace(/<!--[\s\S]*?-->/g, ''), [children]);
  return (
    <div className={cn('tandem-md text-sm break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
