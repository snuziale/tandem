// Model output is UNTRUSTED (spec §4 output contract). This module owns:
// extracting the JSON payload from a pass's text, zod validation, and the
// deterministic post-filters — evidence anchoring, human-thread dedupe, and
// the hard caps. Anything that fails is dropped and counted, never coerced.
import type { ZodType } from 'zod';
import type { FindingJson } from '../../../shared/finding-schema';
import type { DiffLineIndex } from '../../../shared/gh/patch';
import type { ReviewThread } from '../../../shared/review-types';
import type { Severity } from '../../../shared/agent-types';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string };

/** Last ```json fence, else the outermost braces — models pad JSON with prose. */
export function extractJson(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  if (fences.length > 0) return fences[fences.length - 1][1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return null;
}

export function parseWithSchema<T>(text: string, schema: ZodType<T>): ParseResult<T> {
  const raw = extractJson(text);
  if (raw === null) return { ok: false, errors: 'no JSON found in output' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: `invalid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, errors };
  }
  return { ok: true, value: result.data };
}

/**
 * Drop findings that (a) anchor to a file/line not present in the provided
 * diff — hallucinated anchors — or (b) duplicate an existing human thread's
 * (path, line): if a human already said it, the agent stays quiet (spec §4).
 */
export function sanitizeFindings(
  findings: FindingJson[],
  lineIndexByPath: Map<string, DiffLineIndex>,
  threads: ReviewThread[]
): { kept: FindingJson[]; discarded: number } {
  const humanAnchors = new Set(threads.filter((t) => t.line !== null).map((t) => `${t.path}:${t.side}:${t.line}`));
  const kept: FindingJson[] = [];
  let discarded = 0;
  for (const finding of findings) {
    const index = lineIndexByPath.get(finding.path);
    const side = finding.side === 'LEFT' ? index?.left : index?.right;
    const anchored =
      !!side && side.has(finding.endLine) && (finding.startLine === undefined || finding.startLine <= finding.endLine);
    const humanCovered = humanAnchors.has(`${finding.path}:${finding.side}:${finding.endLine}`);
    if (!anchored || humanCovered) {
      discarded++;
      continue;
    }
    kept.push(finding);
  }
  return { kept, discarded };
}

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, risk: 1, question: 2, praise: 3, nit: 4 };

/** Rank by severity × confidence, enforce the hard caps (default 8 total, 3 nits). */
export function capFindings(findings: FindingJson[], findingCap: number, nitCap: number): FindingJson[] {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence
  );
  const out: FindingJson[] = [];
  let nits = 0;
  for (const finding of sorted) {
    if (out.length >= findingCap) break;
    if (finding.severity === 'nit') {
      if (nits >= nitCap) continue;
      nits++;
    }
    out.push(finding);
  }
  return out;
}
