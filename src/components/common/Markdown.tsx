import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@uipath/apollo-wind";
import { openPrExternal } from "../../actions/queue";
import { findCodeRefs, type CodeRef } from "./codeRefs";
import { rehypeGithubAlerts } from "./mdAlerts";
import { stripHtmlComments } from "./markdownText";
import { CODE_REF_CLASS, rehypeCodeRefs } from "./mdCodeRefs";

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

/** With `onRefClick`: the same chain plus the file:line linkifier, which runs
 * last for the same reason the alerts plugin does — what it adds is ours. */
const REHYPE_WITH_REFS = [...REHYPE, rehypeCodeRefs] as const;

/** `language-ts` → `ts`, for the code fence's corner label. */
function languageOf(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const match = /language-([\w+#-]+)/.exec(className);
  return match ? match[1] : null;
}

/**
 * A link in rendered markdown must never navigate the SPA away from the
 * review — least of all in the native webview, where there is no back button.
 *
 * One function because there are two `a` overrides: the default set below, and
 * the chat variant that also has to recognise a linkified `path.ts:42`.
 */
function openExternalLink(
  e: { preventDefault: () => void },
  href: string | undefined,
): void {
  if (!href) return;
  e.preventDefault();
  openPrExternal(href);
}

const COMPONENTS: Components = {
  a({ href, children, ...rest }) {
    return (
      <a {...rest} href={href} onClick={(e) => openExternalLink(e, href)}>
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
  onRefClick,
}: {
  children: string;
  className?: string;
  /** Opt in to file:line linkification. Absent — the case for every PR
   * description and thread comment — nothing is rewritten and the render is
   * exactly what it always was. */
  onRefClick?: (ref: CodeRef) => void;
}) {
  // rehype-raw would otherwise keep a PR template's comments as comment nodes.
  const cleaned = useMemo(() => stripHtmlComments(children), [children]);
  // One `a` override serves both jobs: a real link opens externally, and a
  // reference the linkifier added moves the diff. Told apart by the attribute
  // the plugin wrote, never by the href.
  const components = useMemo<Components>(() => {
    if (!onRefClick) return COMPONENTS;
    return {
      ...COMPONENTS,
      a({ href, children: kids, className: cls, ...rest }) {
        const ours =
          typeof cls === "string" && cls.split(" ").includes(CODE_REF_CLASS);
        // The plugin makes the reference text the element's only child, so
        // this is the same string it matched.
        const written = Array.isArray(kids) ? kids[0] : kids;
        if (ours && typeof written === "string") {
          const hit = findCodeRefs(written)[0];
          if (hit) {
            return (
              <button
                type="button"
                className={CODE_REF_CLASS}
                onClick={() => onRefClick(hit.ref)}
              >
                {written}
              </button>
            );
          }
        }
        // Not one of ours — the ONE external-link handler, shared with
        // COMPONENTS.a so a future fix there reaches chat prose too.
        return (
          <a
            {...rest}
            className={cls}
            href={href}
            onClick={(e) => openExternalLink(e, href)}
          >
            {kids}
          </a>
        );
      },
    };
  }, [onRefClick]);
  return (
    <div className={cn("tandem-md text-sm break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={(onRefClick ? REHYPE_WITH_REFS : REHYPE) as never}
        components={components}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
