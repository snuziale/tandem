import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { CODE_REF_CLASS, rehypeCodeRefs } from "./mdCodeRefs";

const text = (value: string) => ({ type: "text", value }) as const;

function el(tagName: string, children: Element["children"]): Element {
  return { type: "element", tagName, properties: {}, children };
}

function tree(...children: Root["children"]): Root {
  return { type: "root", children };
}

function run(root: Root): Root {
  rehypeCodeRefs()(root);
  return root;
}

/** Flatten to `tag(text)` so an assertion reads as the rendered shape. */
function shape(node: Root | Element): string {
  return node.children
    .map((child) => {
      if (child.type === "text") return child.value;
      if (child.type === "element")
        return `<${child.tagName}${
          Array.isArray(child.properties?.className)
            ? `.${child.properties.className.join(".")}`
            : ""
        }>${shape(child)}</${child.tagName}>`;
      return "";
    })
    .join("");
}

describe("rehypeCodeRefs", () => {
  it("splits a reference out of surrounding prose", () => {
    const root = run(
      tree(el("p", [text("The walk at patch.ts:213 is wrong.")])),
    );
    expect(shape(root)).toBe(
      `<p>The walk at <a.${CODE_REF_CLASS}>patch.ts:213</a> is wrong.</p>`,
    );
  });

  it("makes the reference text the anchor's only child", () => {
    const root = run(tree(el("p", [text("see patch.ts:213")])));
    const p = root.children[0] as Element;
    const anchor = p.children[1] as Element;
    expect(anchor.children).toEqual([{ type: "text", value: "patch.ts:213" }]);
  });

  it("handles several references in one node", () => {
    const root = run(tree(el("p", [text("a.ts:1 then b.ts:2")])));
    expect(shape(root)).toBe(
      `<p><a.${CODE_REF_CLASS}>a.ts:1</a> then <a.${CODE_REF_CLASS}>b.ts:2</a></p>`,
    );
  });

  it("walks inline code — that is where citations are written", () => {
    const root = run(tree(el("p", [el("code", [text("patch.ts:213")])])));
    expect(shape(root)).toBe(
      `<p><code><a.${CODE_REF_CLASS}>patch.ts:213</a></code></p>`,
    );
  });

  it("leaves a code BLOCK alone — it is a quotation of the source", () => {
    const root = run(
      tree(el("pre", [el("code", [text("import x from 'a.ts:1'")])])),
    );
    expect(shape(root)).toBe("<pre><code>import x from 'a.ts:1'</code></pre>");
  });

  it("never nests an anchor inside a link", () => {
    const root = run(tree(el("p", [el("a", [text("patch.ts:213")])])));
    expect(shape(root)).toBe("<p><a>patch.ts:213</a></p>");
  });

  it("leaves prose with no references untouched", () => {
    const root = run(tree(el("p", [text("nothing to see here")])));
    expect(shape(root)).toBe("<p>nothing to see here</p>");
  });
});
