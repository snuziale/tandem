import { describe, expect, it } from "vitest";
import { createFenceGate, splitTrailingJson } from "./prose";

function streamThrough(chunks: string[]): string {
  const gate = createFenceGate();
  return chunks.map((c) => gate.push(c)).join("") + gate.flush();
}

describe("createFenceGate", () => {
  it("passes plain prose through unchanged", () => {
    expect(streamThrough(["Line ", "43 drops the ", "error."])).toBe(
      "Line 43 drops the error.",
    );
  });

  it("suppresses the action fence and everything after it", () => {
    expect(
      streamThrough(['Softened it.\n\n```json\n{"actions":[]}\n```\n']),
    ).toBe("Softened it.\n\n");
  });

  it("suppresses a fence split across chunks", () => {
    expect(streamThrough(["Softened it.\n\n``", "`js", 'on\n{"a":1}'])).toBe(
      "Softened it.\n\n",
    );
  });

  it("does not eat a code block in the middle of an answer", () => {
    const out = streamThrough([
      "Use this:\n```ts\nconst x = 1;\n```\nThat's it.",
    ]);
    expect(out).toBe("Use this:\n```ts\nconst x = 1;\n```\nThat's it.");
  });

  it("flushes a trailing partial marker that never became a fence", () => {
    expect(streamThrough(["done``"])).toBe("done``");
  });
});

describe("splitTrailingJson", () => {
  it("returns prose only when there is no fence", () => {
    expect(splitTrailingJson(" just prose ")).toEqual({
      prose: "just prose",
      tail: null,
    });
  });

  it("peels a trailing json fence", () => {
    const { prose, tail } = splitTrailingJson(
      'Reworded.\n\n```json\n{"actions":[{"kind":"dismiss-finding"}]}\n```',
    );
    expect(prose).toBe("Reworded.");
    expect(tail).toEqual({ actions: [{ kind: "dismiss-finding" }] });
  });

  it("leaves a code block alone when prose follows it", () => {
    const text = 'Try:\n```json\n{"a":1}\n```\nDoes that help?';
    expect(splitTrailingJson(text)).toEqual({ prose: text, tail: null });
  });

  it("keeps a malformed tail visible instead of swallowing it", () => {
    const text = "Reworded.\n\n```json\n{not json}\n```";
    expect(splitTrailingJson(text)).toEqual({ prose: text, tail: null });
  });

  it("uses the LAST fence when the answer contains several", () => {
    const { prose, tail } = splitTrailingJson(
      'Compare:\n```ts\nfoo()\n```\nSo:\n```json\n{"actions":[]}\n```',
    );
    expect(prose).toBe("Compare:\n```ts\nfoo()\n```\nSo:");
    expect(tail).toEqual({ actions: [] });
  });
});
