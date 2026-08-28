import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@uipath/apollo-wind";
import { openPrExternal } from "../../actions/queue";
import { rehypeGithubAlerts } from "./mdAlerts";

// The one markdown renderer: PR descriptions, thread comments, finding bodies,
// staged comments. react-markdown builds a React tree (no innerHTML).
//
// GitHub bodies are FULL of inline HTML — <details>/<summary>, <img>, <br>,
// <kbd>, <sub> — so raw HTML is parsed (rehype-raw) and then filtered through
// hast-util-sanitize's default schema, which IS GitHub's own allowlist: no
// script, no event handlers, no javascript: URLs. Dropping the HTML instead
// (skipHtml) silently ate half of every templated description.
//
// Plugin ORDER matters: raw → sanitize → our own decorations.
// Styles live under `.tandem-md` in index.css — compact, review-density.
//
// The default schema follows GitHub's MARKDOWN sanitizer, which has no
// `video` — GitHub renders an attachment's player itself rather than letting
// an author write the tag. We do write it (shared/gh/attachments.ts turns a
// bare attachment link into one, which is the whole reason a demo recording
// shows up at all), and a hand-written <video><source> is legitimate in a
// description too, so both are allowed back in. Nothing else is widened: no
// script, no event handlers, no javascript: URLs, exactly as before.
const SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "video"],
  attributes: {
    ...defaultSchema.attributes,
    video: ["src", "poster", "controls", "loop", "muted", "playsInline"],
    // `source` is already allowed, but only for srcSet — a <picture>. A
    // <video>'s child needs the other two.
    source: [...(defaultSchema.attributes?.source ?? []), "src", "type"],
  },
};

const REHYPE = [
  rehypeRaw,
  [rehypeSanitize, SCHEMA],
  rehypeGithubAlerts,
] as const;

/** `language-ts` → `ts`, for the code fence's corner label. */
function languageOf(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const match = /language-([\w+#-]+)/.exec(className);
  return match ? match[1] : null;
}

const COMPONENTS: Components = {
  // A description link must never navigate the SPA away from the review —
  // least of all in the native webview, where there is no back button.
  a({ href, children, ...rest }) {
    return (
      <a
        {...rest}
        href={href}
        onClick={(e) => {
          if (!href) return;
          e.preventDefault();
          openPrExternal(href);
        }}
      >
        {children}
      </a>
    );
  },

  // A wide table scrolls inside its own box instead of stretching the pane.
  table({ children, ...rest }) {
    return (
      <div className="tandem-md-table">
        <table {...rest}>{children}</table>
      </div>
    );
  },

  // Fenced blocks carry their language in the corner, like GitHub's.
  pre({ children, ...rest }) {
    const child = Array.isArray(children) ? children[0] : children;
    const props = (child as { props?: { className?: unknown } } | undefined)
      ?.props;
    const language = languageOf(props?.className);
    return (
      <pre {...rest} data-language={language ?? undefined}>
        {children}
      </pre>
    );
  },
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  // PR templates ship as HTML comments; rehype-raw would otherwise keep them
  // as comment nodes and the "empty description" check would miss them.
  const cleaned = useMemo(
    () => children.replace(/<!--[\s\S]*?-->/g, ""),
    [children],
  );
  return (
    <div className={cn("tandem-md text-sm break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={REHYPE as never}
        components={COMPONENTS}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
