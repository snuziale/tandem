// Prompt assembly for the three passes (spec §4). The INSTRUCTION halves come
// from settings.prompts (user-editable, defaults in shared/prompt-defaults.ts);
// the data blocks and the JSON output contracts below are code-owned — the
// contracts must match the zod schemas in shared/finding-schema.ts, and
// parse.ts re-enforces the rules deterministically regardless of edits.
import type { Pass1Plan, FindingJson } from '../../../shared/finding-schema';
import type { PromptTexts } from '../../../shared/prompt-defaults';
import type { FileChange, PullRequest, ReviewThread } from '../../../shared/review-types';

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
  prompts: PromptTexts;
  pr: PullRequest;
  files: FileChange[];
  conventions: string | null;
  commitSubjects: string[];
}): string {
  const fileList = input.files
    .map((f) => `- ${f.path} (${f.status}, +${f.additions} −${f.deletions}${f.isGenerated ? ', generated' : ''})`)
    .join('\n');
  return `${input.prompts.orient}

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
  prompts: PromptTexts;
  pr: PullRequest;
  plan: Pass1Plan;
  files: FileChange[];
  conventions: string | null;
}): string {
  return `${input.prompts.analyze}

${input.prompts.rules}

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
          .map((t) => `- ${t.path}:${t.line ?? '?'} (@${t.comments[0]?.author ?? '?'}${t.isResolved ? ', resolved' : ''}): ${t.comments[0]?.bodyMarkdown.slice(0, 200) ?? ''}`)
          .join('\n')
      : '(none)';
  const mission = input.prompts.reconcile
    .replaceAll('{findingCap}', String(input.findingCap))
    .replaceAll('{nitCap}', String(input.nitCap));
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
