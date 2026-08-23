// zod schemas for the agent's strict-JSON output contract (spec §4). The
// pipeline validates every pass's output against these; on failure it gets one
// repair attempt, then the run fails visibly. Model output is untrusted —
// anything not matching is rejected, never coerced into the UI.
import { z } from "zod";

export const EvidenceSchema = z.object({
  path: z.string().min(1),
  lines: z.string().min(1),
  why: z.string().min(1),
});

export const FindingJsonSchema = z.object({
  path: z.string().min(1),
  side: z.enum(["LEFT", "RIGHT"]).default("RIGHT"),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive(),
  severity: z.enum(["blocker", "risk", "nit", "question", "praise"]),
  category: z.enum([
    "correctness",
    "security",
    "performance",
    "api-contract",
    "test-gap",
    "style",
    "docs",
  ]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  suggestion: z.string().max(8000).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
});

export type FindingJson = z.infer<typeof FindingJsonSchema>;

/** Pass 1 (orient): a short review plan for this specific PR. */
export const Pass1PlanSchema = z.object({
  checks: z.array(z.string().min(1)).min(1).max(8),
  /** Optional file clusters for pass 2; unlisted files fall into a default cluster. */
  clusters: z.array(z.array(z.string().min(1)).min(1)).optional(),
});
export type Pass1Plan = z.infer<typeof Pass1PlanSchema>;

/** Pass 2 (analyze): candidate findings. Empty is a correct, expected outcome. */
export const Pass2OutputSchema = z.object({
  findings: z.array(FindingJsonSchema),
});
export type Pass2Output = z.infer<typeof Pass2OutputSchema>;

/** Pass 3 (reconcile): the final ranked, capped set, the run summary, and a
 * 0-100 merge-readiness score (drives the opt-in auto-approve gate). */
export const Pass3OutputSchema = z.object({
  summary: z.string().min(1).max(4000),
  findings: z.array(FindingJsonSchema),
  score: z.number().min(0).max(100).optional(),
});
export type Pass3Output = z.infer<typeof Pass3OutputSchema>;
