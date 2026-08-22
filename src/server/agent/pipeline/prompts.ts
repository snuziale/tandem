// Prompt builders for the three passes (spec §4). The review rules live in
// RULES verbatim — every quality lever the spec names is enforced here first,
// then re-checked deterministically in parse.ts.
import type { Pass1Plan, FindingJson } from '../../../shared/finding-schema';
import type { FileChange, PullRequest, ReviewThread } from '../../../shared/review-types';

const RULES = `Rules — follow every one:
- Every finding must cite evidence: a file and line range you actually read in the diff below.
- No findings about formatting, import order, naming style, or anything a linter/formatter owns.
- Never restate what the diff does. If the comment would be obvious to the author, drop it.
- "blocker" means the code is wrong or unsafe — NOT that you would have written it differently.
- Emitting zero findings is a correct and expected outcome. Do not invent work.
- When you are uncertain, emit a "question" instead of a low-confidence assertion.
- Line anchors: side "RIGHT" + a line number that exists in the NEW file's diff lines (additions or context), or side "LEFT" + a line from the old file (deletions). endLine is the anchor; startLine only for multi-line ranges.
- "suggestion" is the exact replacement text for lines startLine..endLine — include it only when you are confident in the exact code.`;

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

function prHeaderBlock(pr: PullRequest): string {
  return `PR: ${pr.title} (#${pr.number}, ${pr.owner}/${pr.repo})
Author: @${pr.author} · ${pr.headRef} → ${pr.baseRef} · +${pr.additions} −${pr.deletions} across ${pr.changedFiles} files

Description:
${pr.bodyMarkdown.slice(0, 4000) || '(none)'}`;
}

function fileDiffBlock(files: FileChange[]): string {
  return files
    .map((f) => `### ${f.path} (${f.status}, +${f.additions} −${f.deletions})\n${f.patch ?? '(no patch)'}`)
    .join('\n\n');
}

function conventionsBlock(conventions: string | null): string {
  return conventions ? `\nRepo conventions (.tandem/conventions.md — treat as house rules):\n${conventions.slice(0, 8000)}\n` : '';
}

export function buildOrientPrompt(input: {
  pr: PullRequest;
  files: FileChange[];
  conventions: string | null;
  commitSubjects: string[];
}): string {
  const fileList = input.files
    .map((f) => `- ${f.path} (${f.status}, +${f.additions} −${f.deletions}${f.isGenerated ? ', generated' : ''})`)
    .join('\n');
  return `You are the reviewing agent inside Tandem, a code-review client. A human reviewer will triage everything you produce; nothing you write reaches GitHub.

Pass 1 of 3 — ORIENT. Read the PR metadata and produce a short review plan: the 3-6 things actually worth checking in THIS specific PR. Be concrete ("does the new reducer handle the COMMIT race", not "check correctness").

${prHeaderBlock(input.pr)}

Changed files:
${fileList}
${conventionsBlock(input.conventions)}
Recent commits on the base branch (for context on what this codebase is doing):
${input.commitSubjects.map((s) => `- ${s}`).join('\n') || '(none)'}

Reply with ONLY a JSON object in a \`\`\`json fence:
{ "checks": ["...", "..."], "clusters": [["path", "path"], ...] (optional file groupings for deep analysis) }`;
}

export function buildAnalyzePrompt(input: {
  pr: PullRequest;
  plan: Pass1Plan;
  files: FileChange[];
  conventions: string | null;
}): string {
  return `You are the reviewing agent inside Tandem, a code-review client. A human reviewer will triage everything you produce; nothing you write reaches GitHub.

Pass 2 of 3 — ANALYZE. Apply the review plan to the diffs below and emit candidate findings.

${RULES}

${prHeaderBlock(input.pr)}

Review plan (from pass 1):
${input.plan.checks.map((c) => `- ${c}`).join('\n')}
${conventionsBlock(input.conventions)}
Diffs to analyze (unified format; left column = old lines, +lines are new):

${fileDiffBlock(input.files)}

Reply with ONLY a JSON object in a \`\`\`json fence:
{ "findings": [ ${FINDING_SHAPE} , ... ] }
An empty findings array is a valid answer.`;
}

export function buildReconcilePrompt(input: {
  pr: PullRequest;
  candidates: FindingJson[];
  threads: ReviewThread[];
  findingCap: number;
  nitCap: number;
}): string {
  const threadsBlock =
    input.threads.length > 0
      ? input.threads
          .map((t) => `- ${t.path}:${t.line ?? '?'} (@${t.comments[0]?.author ?? '?'}${t.isResolved ? ', resolved' : ''}): ${t.comments[0]?.bodyMarkdown.slice(0, 200) ?? ''}`)
          .join('\n')
      : '(none)';
  return `You are the reviewing agent inside Tandem, a code-review client. A human reviewer will triage everything you produce; nothing you write reaches GitHub.

Pass 3 of 3 — RECONCILE. Below are ALL candidate findings from analysis, plus the review comments humans have already left. Produce the final signal-dense set:
- Merge duplicates (keep the better-written one, highest severity wins).
- DROP any finding that substantively duplicates an existing human comment.
- Re-check each severity against the definitions; downgrade anything hedged.
- Keep at most ${input.findingCap} findings total and at most ${input.nitCap} nits — cut the weakest.
- Write a run summary: 2-4 sentences on what you read, what is sound, and what needs attention. Written for the reviewer, plain prose, no hedging. If checks are failing or something outside the diff matters, say so.

${RULES}

${prHeaderBlock(input.pr)}

Existing human review comments:
${threadsBlock}

Candidate findings:
\`\`\`json
${JSON.stringify(input.candidates, null, 1)}
\`\`\`

Reply with ONLY a JSON object in a \`\`\`json fence:
{ "summary": "...", "findings": [ ${FINDING_SHAPE} , ... ] }
Zero findings with a summary saying the change is sound is a valid, good answer.`;
}

export function buildRepairPrompt(originalOutput: string, errors: string): string {
  return `Your previous reply failed strict-JSON validation.

Validation errors:
${errors}

Your previous reply:
${originalOutput.slice(0, 12000)}

Reply with ONLY the corrected JSON object in a \`\`\`json fence. Fix the validation errors without changing the substance. Drop any item that cannot be fixed.`;
}
