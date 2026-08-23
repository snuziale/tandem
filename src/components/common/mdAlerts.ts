// GitHub alerts (`> [!NOTE]` … `> [!CAUTION]`) are plain blockquotes to
// remark-gfm — GitHub styles them as callouts. This rehype plugin does that
// last step: find the marker in a blockquote's first paragraph, drop it, and
// tag the blockquote so `.tandem-md-alert-*` in index.css can paint it.
//
// Runs AFTER rehype-sanitize on purpose: the class names it adds are ours, not
// the document's, so they must not be subject to (or stripped by) the allowlist.
import type { Element, Root, RootContent, Text } from "hast";

const LABEL = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;

export type AlertKind = keyof typeof LABEL;

const MARKER = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i;

function isElement(node: RootContent, tagName?: string): node is Element {
  return (
    node.type === "element" &&
    (tagName === undefined || node.tagName === tagName)
  );
}

/** The marker sits in the first text node of the blockquote's first paragraph. */
function takeKind(blockquote: Element): AlertKind | null {
  const paragraph = blockquote.children.find((child) => isElement(child, "p"));
  if (!paragraph || !isElement(paragraph)) return null;
  const first = paragraph.children[0];
  if (!first || first.type !== "text") return null;
  const match = MARKER.exec((first as Text).value);
  if (!match) return null;

  (first as Text).value = (first as Text).value
    .slice(match[0].length)
    .replace(/^\n/, "");
  // A marker on its own line leaves an empty text node plus the <br> that
  // followed it — both would render as a blank first line.
  if (!(first as Text).value) {
    paragraph.children.shift();
    if (paragraph.children[0] && isElement(paragraph.children[0], "br"))
      paragraph.children.shift();
  }
  if (paragraph.children.length === 0) {
    blockquote.children.splice(blockquote.children.indexOf(paragraph), 1);
  }
  return match[1].toLowerCase() as AlertKind;
}

function titleOf(kind: AlertKind): Element {
  return {
    type: "element",
    tagName: "p",
    properties: { className: ["tandem-md-alert-title"] },
    children: [{ type: "text", value: LABEL[kind] }],
  };
}

function walk(nodes: RootContent[]): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tagName === "blockquote") {
      const kind = takeKind(node);
      if (kind) {
        node.properties = {
          ...node.properties,
          className: ["tandem-md-alert", `tandem-md-alert-${kind}`],
        };
        node.children.unshift(titleOf(kind));
        continue;
      }
    }
    walk(node.children);
  }
}

export function rehypeGithubAlerts() {
  return (tree: Root): void => walk(tree.children);
}
