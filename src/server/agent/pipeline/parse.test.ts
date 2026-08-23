import { describe, expect, it } from "vitest";
import {
  Pass2OutputSchema,
  type FindingJson,
} from "../../../shared/finding-schema";
import { diffLineIndex } from "../../../shared/gh/patch";
import type { ReviewThread } from "../../../shared/review-types";
import {
  capFindings,
  extractJson,
  parseWithSchema,
  sanitizeFindings,
} from "./parse";

function finding(overrides: Partial<FindingJson> = {}): FindingJson {
  return {
    path: "src/a.ts",
    side: "RIGHT",
    endLine: 11,
    severity: "risk",
    category: "correctness",
    title: "Something wrong",
    body: "Details.",
    confidence: 0.8,
    evidence: [{ path: "src/a.ts", lines: "11", why: "read it" }],
    ...overrides,
  };
}

describe("extractJson", () => {
  it("prefers the last json fence", () => {
    const text =
      'thinking...\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```\ndone';
    expect(extractJson(text)).toBe('{"b":2}');
  });
  it("falls back to outermost braces", () => {
    expect(extractJson('Here you go: {"findings": []} hope that helps')).toBe(
      '{"findings": []}',
    );
  });
  it("null when no JSON at all", () => {
    expect(extractJson("I cannot do that")).toBeNull();
  });
});

describe("parseWithSchema", () => {
  it("accepts a valid pass-2 payload", () => {
    const result = parseWithSchema(
      `\`\`\`json\n${JSON.stringify({ findings: [finding()] })}\n\`\`\``,
      Pass2OutputSchema,
    );
    expect(result.ok).toBe(true);
  });
  it("reports zod issues on shape mismatch", () => {
    const result = parseWithSchema(
      '{"findings": [{"path": ""}]}',
      Pass2OutputSchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("findings.0");
  });
});

describe("sanitizeFindings", () => {
  const index = new Map([
    ["src/a.ts", diffLineIndex("@@ -10,2 +10,3 @@\n ctx\n-old\n+new1\n+new2")],
  ]);
  // right side: 10, 11, 12 · left side: 10, 11

  it("drops hallucinated anchors (wrong line, wrong file, wrong side)", () => {
    const { kept, discarded } = sanitizeFindings(
      [
        finding({ endLine: 11 }),
        finding({ endLine: 99 }),
        finding({ path: "src/other.ts" }),
        finding({ side: "LEFT", endLine: 12 }),
      ],
      index,
      [],
    );
    expect(kept).toHaveLength(1);
    expect(discarded).toBe(3);
  });

  it("drops findings a human thread already covers", () => {
    const thread: ReviewThread = {
      id: "T1",
      path: "src/a.ts",
      line: 11,
      side: "RIGHT",
      isResolved: false,
      isOutdated: false,
      comments: [],
    };
    const { kept, discarded } = sanitizeFindings(
      [finding({ endLine: 11 }), finding({ endLine: 12 })],
      index,
      [thread],
    );
    expect(kept.map((f) => f.endLine)).toEqual([12]);
    expect(discarded).toBe(1);
  });
});

describe("capFindings", () => {
  it("ranks severity then confidence and caps nits", () => {
    const input = [
      finding({ severity: "nit", title: "n1", confidence: 0.9 }),
      finding({ severity: "nit", title: "n2", confidence: 0.8 }),
      finding({ severity: "nit", title: "n3", confidence: 0.7 }),
      finding({ severity: "blocker", title: "b1", confidence: 0.5 }),
      finding({ severity: "risk", title: "r1", confidence: 0.9 }),
      finding({ severity: "risk", title: "r2", confidence: 0.95 }),
    ];
    const out = capFindings(input, 5, 2);
    expect(out.map((f) => f.title)).toEqual(["b1", "r2", "r1", "n1", "n2"]);
  });

  it("enforces the total cap", () => {
    const input = Array.from({ length: 12 }, (_, i) =>
      finding({ title: `f${i}`, severity: "risk" }),
    );
    expect(capFindings(input, 8, 3)).toHaveLength(8);
  });
});
