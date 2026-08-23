import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { rehypeGithubAlerts } from "./mdAlerts";

function blockquote(...children: Element["children"]): Element {
  return { type: "element", tagName: "blockquote", properties: {}, children };
}

function paragraph(...children: Element["children"]): Element {
  return { type: "element", tagName: "p", properties: {}, children };
}

const br: Element = {
  type: "element",
  tagName: "br",
  properties: {},
  children: [],
};

function run(tree: Root): Root {
  rehypeGithubAlerts()(tree);
  return tree;
}

function classOf(node: Element): unknown {
  return node.properties?.className;
}

describe("rehypeGithubAlerts", () => {
  it("tags a marked blockquote and drops the marker text", () => {
    const quote = blockquote(
      paragraph({ type: "text", value: "[!WARNING] mind the gap" }),
    );
    run({ type: "root", children: [quote] });

    expect(classOf(quote)).toEqual([
      "tandem-md-alert",
      "tandem-md-alert-warning",
    ]);
    const [title, body] = quote.children as Element[];
    expect(title.children).toEqual([{ type: "text", value: "Warning" }]);
    expect(body.children).toEqual([{ type: "text", value: "mind the gap" }]);
  });

  it("handles a marker on its own line (marker text + <br>)", () => {
    const quote = blockquote(
      paragraph({ type: "text", value: "[!NOTE]\n" }, br, {
        type: "text",
        value: "body text",
      }),
    );
    run({ type: "root", children: [quote] });

    const [title, body] = quote.children as Element[];
    expect(title.children).toEqual([{ type: "text", value: "Note" }]);
    expect(body.children).toEqual([{ type: "text", value: "body text" }]);
  });

  it("leaves a plain blockquote alone", () => {
    const quote = blockquote(
      paragraph({ type: "text", value: "just a quote" }),
    );
    run({ type: "root", children: [quote] });

    expect(classOf(quote)).toBeUndefined();
    expect(quote.children).toHaveLength(1);
  });

  it("finds nested blockquotes", () => {
    const inner = blockquote(
      paragraph({ type: "text", value: "[!tip] nested" }),
    );
    const list: Element = {
      type: "element",
      tagName: "li",
      properties: {},
      children: [inner],
    };
    run({
      type: "root",
      children: [
        { type: "element", tagName: "ul", properties: {}, children: [list] },
      ],
    });

    expect(classOf(inner)).toEqual(["tandem-md-alert", "tandem-md-alert-tip"]);
  });

  it("empties the paragraph away when the marker was its only content", () => {
    const quote = blockquote(
      paragraph({ type: "text", value: "[!CAUTION]" }),
      paragraph({ type: "text", value: "after" }),
    );
    run({ type: "root", children: [quote] });

    const kids = quote.children as Element[];
    expect(kids).toHaveLength(2);
    expect(kids[0].properties?.className).toEqual(["tandem-md-alert-title"]);
    expect(kids[1].children).toEqual([{ type: "text", value: "after" }]);
  });
});
