// Turns every `path.ts:42` in rendered markdown into a control the reader can
// click. The matching itself is pure and tested (codeRefs.ts); this is the
// hast walk that splits text nodes on its offsets.
//
// Runs AFTER rehype-sanitize, like mdAlerts, for the same reason: the elements
// and attributes it adds are OURS, not the document's, so they must not be
// subject to (or stripped by) the allowlist. Nothing here reads document
// content into an attribute except the reference text the regex matched.
//
// `pre` subtrees are skipped. A code BLOCK is a quotation of the source, and
// peppering it with buttons would make the quotation lie about itself; inline
// `code` is exactly where the agent writes a citation, so that one is walked.
import type { Element, Root, RootContent, Text } from "hast";
import { findCodeRefs } from "./codeRefs";

/**
 * The class a linkified reference carries. Markdown's `a` override reads it to
 * tell one of ours from a real link in a PR description.
 *
 * A CLASS rather than a `data-` attribute on purpose: `className` is a
 * standard prop that every hast→JSX renderer maps, while an unknown `data-*`
 * key's spelling on the React side depends on the renderer's property table.
 * The reference text is the element's only child, so nothing else has to
 * survive the trip either.
 */
export const CODE_REF_CLASS = "tandem-md-ref";

function refElement(text: string): Element {
  return {
    type: "element",
    tagName: "a",
    properties: {
      // A real href would let a middle-click open nothing; the handler
      // preventDefaults and this keeps the element focusable and semantic.
      href: "#",
      className: [CODE_REF_CLASS],
    },
    children: [{ type: "text", value: text }],
  };
}

/** Split one text node into text + anchor runs. Returns null when it has no
 * references, so the common case allocates nothing. */
function splitText(node: Text): RootContent[] | null {
  const hits = findCodeRefs(node.value);
  if (hits.length === 0) return null;
  const out: RootContent[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start > at)
      out.push({ type: "text", value: node.value.slice(at, hit.start) });
    out.push(refElement(hit.text));
    at = hit.end;
  }
  if (at < node.value.length)
    out.push({ type: "text", value: node.value.slice(at) });
  return out;
}

function walk(parent: Element | Root): void {
  const next: RootContent[] = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === "text") {
      const split = splitText(child);
      if (split) {
        next.push(...split);
        changed = true;
        continue;
      }
      next.push(child);
      continue;
    }
    if (child.type === "element") {
      // Never inside a link (it would nest anchors) or a code block.
      if (child.tagName !== "a" && child.tagName !== "pre") walk(child);
    }
    next.push(child);
  }
  if (changed) parent.children = next;
}

export function rehypeCodeRefs() {
  return (tree: Root) => {
    walk(tree);
  };
}
