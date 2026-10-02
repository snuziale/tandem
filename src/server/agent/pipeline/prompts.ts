// Prompt assembly for the three passes (spec §4). The INSTRUCTION halves come
// from settings.prompts (user-editable, defaults in shared/prompt-defaults.ts);
// the data blocks and the JSON output contracts below are code-owned — the
// contracts must match the zod schemas in shared/finding-schema.ts, and
// parse.ts re-enforces the rules deterministically regardless of edits.
import type { budgetFiles } from "../../../shared/agent-context";
import type { Pass1Plan, FindingJson } from "../../../shared/finding-schema";
import type { PromptTexts } from "../../../shared/prompt-defaults";
import type {
  FileChange,
  PullRequest,
  ReviewThread,
} from "../../../shared/review-types";

const FINDING_SHAPE = `{
  "path": "file path from the diff",
  "side": "RIGHT" | "LEFT",
  "startLine": number (optional),
  "endLine": number,
  "severity": "blocker" | "risk" | "nit" | "question" | "praise",
  "category": "correctness" | "security" | "performance" | "api-contract" | "test-gap" | "style" | "docs",
  "title": "one line, imperative or declarative, no hedging",
  "body": "markdown, 1-3 sentences",
  "suggestion": "exact replacement text (optional)",
  "confidence": 0.0-1.0,
  "evidence": [{ "path": "...", "lines": "43-45", "why": "what this shows" }]
}`;

export function prHeaderBlock(pr: PullRequest): string {
  return `PR: ${pr.title} (#${pr.number}, ${pr.owner}/${pr.repo})
Author: @${pr.author} · ${pr.headRef} → ${pr.baseRef} · +${pr.additions} −${pr.deletions} across ${pr.changedFiles} files

Description:
${pr.bodyMarkdown.slice(0, 4000) || "(none)"}`;
}

export function fileDiffBlock(files: FileChange[]): string {
  return files
    .map(
      (f) =>
        `### ${f.path} (${f.status}, +${f.additions} −${f.deletions})\n${f.patch ?? "(no patch)"}`,
    )
    .join("\n\n");
}

/** The repo's own agent instructions (fetchRepoGuidance), already capped and
 * headed per file. */
export function guidanceBlock(guidance: string | null): string {
  return guidance
    ? `\nRepository guidance — the repo's own instructions to reviewers and agents; treat as house rules:\n${guidance}\n`
    : "";
}

/** Files fitted into a budget — what `budgetFiles` returns. */
export type BudgetedFiles = ReturnType<typeof budgetFiles>;

function wholeFilesBlock(
  heading: string,
  budgeted: BudgetedFiles | undefined,
): string {
  if (!budgeted) return "";
  const { included, omitted } = budgeted;
  if (included.length === 0 && omitted.length === 0) return "";
  const body = included
    .map((f) => `#### ${f.path}\n\`\`\`\n${f.text}\n\`\`\``)
    .join("\n\n");
  const tail = omitted.length
    ? `\n(Not included, over the context budget: ${omitted.join(", ")})`
    : "";
  return `\n${heading}\n\n${body}${tail}\n`;
}

/** Where a `repo`-context pass is running, and what it may do there. */
export type CheckoutNote = { repo: string; sha: string; maxTurns: number };

function checkoutBlock(c: CheckoutNote): string {
  return `
You are running INSIDE a read-only checkout of ${c.repo} at this PR's head commit (${c.sha.slice(0, 7)}); the working directory is the repository root. You have Read, Grep and Glob, and nothing that writes. USE them before asserting anything about code outside the diff:
- For every changed exported function, type, prop or signature, Grep for its callers and check they still hold.
- Read the whole file around a hunk before judging it, and read the tests that cover it.
- Check how neighbouring code already does the thing before calling this change inconsistent.
Budget: at most ${Math.max(1, c.maxTurns - 2)} tool calls — stop exploring once each finding has evidence. Paths in findings and evidence are repo-relative, exactly as in the diff; anchors must still be lines IN the diff. Your final message must be the JSON answer and nothing else.
`;
}

export function buildOrientPrompt(input: {
  prompts: PromptTexts;
  pr: PullRequest;
  files: FileChange[];
  guidance: string | null;
  commitSubjects: string[];
  /** Files near the change pass 2 could be given in full. Empty = do not
   * offer (a `diff` profile, or a `repo` one that will read for itself). */
  nearby: string[];
  maxContext: number;
}): string {
  const fileList = input.files
    .map(
      (f) =>
        `- ${f.path} (${f.status}, +${f.additions} −${f.deletions}${f.isGenerated ? ", generated" : ""})`,
    )
    .join("\n");
  return `${input.prompts.orient}

${prHeaderBlock(input.pr)}

Changed files:
${fileList}
${guidanceBlock(input.guidance)}
Recent commits on the base branch (for context on what this codebase is doing):
${input.commitSubjects.map((s) => `- ${s}`).join("\n") || "(none)"}
${
  input.nearby.length
    ? `
The analysis will see every changed file IN FULL. It can also be given up to ${input.maxContext} files that are NOT in the diff — pick the ones a careful reviewer would open: the callers of what changed, the types and interfaces it implements, the tests that cover it. Files near the change:
${input.nearby.map((p) => `- ${p}`).join("\n")}
`
    : ""
}
Reply with ONLY a JSON object in a \`\`\`json fence:
{ "checks": ["...", "..."], "clusters": [["path", "path"], ...] (optional file groupings for deep analysis)${input.nearby.length ? `, "context": ["path", ...] (optional, files from the list above)` : ""} }`;
}

export function buildAnalyzePrompt(input: {
  prompts: PromptTexts;
  pr: PullRequest;
  plan: Pass1Plan;
  files: FileChange[];
  guidance: string | null;
  /** This cluster's changed files, whole, at the head sha. */
  fullFiles?: BudgetedFiles;
  /** Files outside the diff pass 1 asked for (`files` depth). */
  related?: BudgetedFiles;
  /** Set when the pass runs inside a checkout with read-only tools. */
  checkout?: CheckoutNote;
}): string {
  return `${input.prompts.analyze}

${input.prompts.rules}
${input.checkout ? checkoutBlock(input.checkout) : ""}
${prHeaderBlock(input.pr)}

Review plan (from pass 1):
${input.plan.checks.map((c) => `- ${c}`).join("\n")}
${guidanceBlock(input.guidance)}${wholeFilesBlock(
    "Related files NOT in the diff, at the PR head (context only — cite them as evidence, never anchor a finding on them):",
    input.related,
  )}${wholeFilesBlock(
    "The changed files IN FULL at the PR head, so you can see what each hunk sits inside (context — anchors still come from the diffs below):",
    input.fullFiles,
  )}
Diffs to analyze (unified format; left column = old lines, +lines are new):

${fileDiffBlock(input.files)}

Reply with ONLY a JSON object in a \`\`\`json fence:
{ "findings": [ ${FINDING_SHAPE} , ... ] }
An empty findings array is a valid answer.`;
}

export function buildReconcilePrompt(input: {
  prompts: PromptTexts;
  pr: PullRequest;
  candidates: FindingJson[];
  threads: ReviewThread[];
  findingCap: number;
  nitCap: number;
}): string {
  const threadsBlock =
    input.threads.length > 0
      ? input.threads
          .map(
            (t) =>
              `- ${t.path}:${t.line ?? "?"} (@${t.comments[0]?.author ?? "?"}${t.isResolved ? ", resolved" : ""}): ${t.comments[0]?.bodyMarkdown.slice(0, 200) ?? ""}`,
          )
          .join("\n")
      : "(none)";
  const mission = input.prompts.reconcile
    .replaceAll("{findingCap}", String(input.findingCap))
    .replaceAll("{nitCap}", String(input.nitCap));
  return `${mission}

${input.prompts.rules}

${prHeaderBlock(input.pr)}

Existing human review comments:
${threadsBlock}

Candidate findings:
\`\`\`json
${JSON.stringify(input.candidates, null, 1)}
\`\`\`

Reply with ONLY a JSON object in a \`\`\`json fence:
{ "summary": "...", "score": 0-100, "findings": [ ${FINDING_SHAPE} , ... ] }
Always include "score": merge readiness, 90+ = safe to approve as-is, 50-89 = reviewable once the findings are addressed, below 50 = substantive problems.
Zero findings with a summary saying the change is sound is a valid, good answer.`;
}

export function buildRepairPrompt(
  originalOutput: string,
  errors: string,
): string {
  return `Your previous reply failed strict-JSON validation.

Validation errors:
${errors}

Your previous reply:
${originalOutput.slice(0, 12000)}

Reply with ONLY the corrected JSON object in a \`\`\`json fence. Fix the validation errors without changing the substance. Drop any item that cannot be fixed.`;
}
