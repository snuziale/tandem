// Prompt assembly for the chat pass. Same split as the pipeline: the MISSION
// half is user-editable (settings → agent → prompts.chat), everything below —
// the data blocks and the action contract — is code-owned, because
// chat/actions.ts re-validates every proposal against these exact ids.
//
// Ordering is deliberate: immutable context first, transcript last. The prefix
// is byte-identical across the turns of a conversation, so prompt caching pays
// for the diff instead of us re-paying per message.
import type { AgentRun, Finding } from "../../../shared/agent-types";
import type { PromptTexts } from "../../../shared/prompt-defaults";
import type {
  FileChange,
  PendingReview,
  PullRequest,
  ReviewThread,
} from "../../../shared/review-types";
import type { ChatMessage } from "../../../shared/chat-types";
import {
  conventionsBlock,
  fileDiffBlock,
  prHeaderBlock,
} from "../pipeline/prompts";

/** Diff budget for a PR-scoped chat. Finding-scoped chats send one file. */
const MAX_DIFF_CHARS = 60_000;
/** How much of the conversation travels with each turn. */
const MAX_TRANSCRIPT_MESSAGES = 20;
const MAX_TRANSCRIPT_CHARS = 12_000;

const ACTION_CONTRACT = `How to propose a change
You cannot edit anything yourself. When the reviewer asks you to change a finding, a nit, or a
staged comment — or when the conversation turns up something worth flagging — end your reply with
ONE \`\`\`json fence containing the proposals. The reviewer sees each as a chip and clicks Apply.

\`\`\`json
{ "actions": [
  { "kind": "revise-finding", "findingId": "<id from the findings block>", "title": "...", "body": "...", "severity": "nit", "suggestion": "exact replacement text or null to drop it", "why": "one line for the chip" },
  { "kind": "dismiss-finding", "findingId": "<id>", "why": "..." },
  { "kind": "new-finding", "finding": { "path": "...", "side": "RIGHT", "endLine": 42, "startLine": 40, "severity": "risk", "category": "correctness", "title": "...", "body": "...", "suggestion": "...", "confidence": 0.8, "evidence": [{ "path": "...", "lines": "40-42", "why": "..." }] }, "why": "..." },
  { "kind": "revise-comment", "localId": "<id from the draft block>", "body": "the full new comment body", "why": "..." }
] }
\`\`\`

- Every field of "revise-finding" except findingId/why is optional — send only what changes.
- A finding that is already STAGED belongs to the draft: revise it with "revise-comment" on the
  matching localId, not with "revise-finding".
- "new-finding" must anchor to a line that exists in the diff below, with real evidence. Anything
  that doesn't anchor is dropped before the reviewer sees it.
- No actions is the normal case. Do not manufacture one to look useful.

If you need a file that is not in the diff below, end the reply with
\`\`\`json
{ "needContext": [{ "path": "src/...", "why": "..." }] }
\`\`\`
and nothing else — the server will fetch it and re-ask you (at most twice per turn).`;

function findingsBlock(run: AgentRun | null): string {
  if (!run)
    return "This PR has no agent run yet — you have no findings of your own to discuss.";
  const lines = run.findings
    .filter((f) => f.state !== "stale")
    .map(
      (f) =>
        `- id=${f.id} [${f.state}] ${f.severity}/${f.category} ${f.path}:${f.endLine} (${f.side})\n  title: ${f.title}\n  body: ${f.body.replace(/\n+/g, " ")}${
          f.suggestion !== undefined ? "\n  has a suggestion" : ""
        }`,
    );
  return `Run ${run.id} · ${run.agentName ?? "agent"} · status ${run.status}${
    run.score !== undefined ? ` · score ${run.score}/100` : ""
  }
Summary you wrote: ${run.summary ?? "(none)"}

Your findings (ids are what actions reference):
${lines.join("\n") || "(none — you flagged nothing)"}`;
}

function threadsBlock(threads: ReviewThread[]): string {
  if (threads.length === 0) return "(none)";
  return threads
    .map(
      (t) =>
        `- ${t.path}:${t.line ?? "?"} (@${t.comments[0]?.author ?? "?"}${
          t.isResolved ? ", resolved" : ""
        }): ${t.comments[0]?.bodyMarkdown.slice(0, 300) ?? ""}`,
    )
    .join("\n");
}

function draftBlock(review: PendingReview | null): string {
  if (!review || review.comments.length === 0)
    return "(the reviewer has staged nothing yet)";
  return review.comments
    .map(
      (c) =>
        `- localId=${c.localId} ${c.path}:${c.line} (${c.side})${
          c.findingId
            ? ` [from finding ${c.findingId}]`
            : " [written by the reviewer]"
        }\n  ${c.body.replace(/\n+/g, " ")}`,
    )
    .join("\n");
}

/** Focused file in full; everything else as a one-line inventory. */
function focusedDiffBlock(files: FileChange[], path: string): string {
  const focused = files.find((f) => f.path === path);
  const others = files
    .filter((f) => f.path !== path)
    .map((f) => `- ${f.path} (${f.status}, +${f.additions} −${f.deletions})`);
  return `${
    focused
      ? fileDiffBlock([focused])
      : `(${path} is not in this PR's diff any more)`
  }

Other files in this PR (ask for one with needContext if you need it):
${others.join("\n") || "(none)"}`;
}

/** As much of the diff as the budget allows, findings-first. */
function budgetedDiffBlock(files: FileChange[], run: AgentRun | null): string {
  const flagged = new Set(
    (run?.findings ?? []).filter((f) => f.state !== "stale").map((f) => f.path),
  );
  const ordered = [...files].sort((a, b) => {
    const rank = (f: FileChange) =>
      (flagged.has(f.path) ? 0 : 1) + (f.isGenerated ? 2 : 0);
    return rank(a) - rank(b);
  });
  const included: FileChange[] = [];
  const omitted: FileChange[] = [];
  let chars = 0;
  for (const file of ordered) {
    const size = (file.patch ?? "").length + file.path.length;
    if (file.patch && chars + size <= MAX_DIFF_CHARS) {
      included.push(file);
      chars += size;
    } else {
      omitted.push(file);
    }
  }
  return `${fileDiffBlock(included)}${
    omitted.length
      ? `\n\nNot included here (ask with needContext if one matters):\n${omitted
          .map((f) => `- ${f.path} (+${f.additions} −${f.deletions})`)
          .join("\n")}`
      : ""
  }`;
}

function transcriptBlock(messages: ChatMessage[]): string {
  const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES);
  const rendered: string[] = [];
  let chars = 0;
  // Newest-first accumulation so the budget drops the OLDEST turns.
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const applied = (m.actions ?? []).filter((a) => a.state === "applied");
    const note = applied.length
      ? `\n(the reviewer applied: ${applied.map((a) => a.kind).join(", ")})`
      : "";
    const text = `${m.role === "user" ? "REVIEWER" : "YOU"}: ${m.text}${note}`;
    if (chars + text.length > MAX_TRANSCRIPT_CHARS) break;
    chars += text.length;
    rendered.unshift(text);
  }
  return rendered.join("\n\n") || "(this is the first turn)";
}

export function buildChatPrompt(input: {
  prompts: PromptTexts;
  pr: PullRequest;
  files: FileChange[];
  conventions: string | null;
  run: AgentRun | null;
  focused: Finding | null;
  threads: ReviewThread[];
  review: PendingReview | null;
  history: ChatMessage[];
  question: string;
  /** Files fetched for this turn because a previous hop asked for them. */
  extraContext: Array<{ path: string; text: string }>;
}): string {
  const scopeLine = input.focused
    ? `This conversation is scoped to ONE finding: id=${input.focused.id}, ${input.focused.severity}/${input.focused.category} at ${input.focused.path}:${input.focused.endLine} — "${input.focused.title}". Answer about it unless the reviewer widens the subject.`
    : "This conversation is scoped to the whole PR.";

  return `${input.prompts.chat}

${scopeLine}

${ACTION_CONTRACT}

${prHeaderBlock(input.pr)}
${conventionsBlock(input.conventions)}
${findingsBlock(input.run)}

Existing human review comments on GitHub:
${threadsBlock(input.threads)}

The reviewer's local draft (not on GitHub — nothing here is public yet):
${draftBlock(input.review)}

Diff:

${
  input.focused
    ? focusedDiffBlock(input.files, input.focused.path)
    : budgetedDiffBlock(input.files, input.run)
}
${
  input.extraContext.length
    ? `\nFiles you asked for, at the PR's head sha:\n\n${input.extraContext
        .map((c) => `### ${c.path}\n\`\`\`\n${c.text}\n\`\`\``)
        .join("\n\n")}\n`
    : ""
}
Conversation so far:
${transcriptBlock(input.history)}

REVIEWER: ${input.question}

Reply now. Prose for the reviewer, then the optional \`\`\`json fence.`;
}
