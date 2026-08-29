// What to ask, computed from what is already on disk.
//
// The empty conversation used to be one sentence of prose inviting the
// reviewer to invent a question — which is the hardest moment in the whole
// panel, because knowing what the agent can answer requires having already
// asked it something. These are the answers to "what can I even ask", drawn
// from the run record and the draft.
//
// EVERY ONE IS FREE. Nothing here calls a model, and nothing is sent until the
// reviewer clicks a chip: invariant §2 says a run costs tokens only on an
// explicit action, and an opener that pre-asked would be exactly the automatic
// spend that rule exists to prevent.
import { analyzableFiles } from "../../shared/agent-cluster";
import {
  openFindings,
  type AgentRun,
  type Finding,
} from "../../shared/agent-types";
import type { FileChange, PendingReview } from "../../shared/review-types";
import { fileName } from "../../utils/agentFormat";

export type ChatOpener = {
  /** Stable across renders — it is the React key. */
  id: string;
  /** What the chip says. Short: the row wraps at the pane's width. */
  label: string;
  /** What is actually sent, which may be longer and more specific. */
  question: string;
};

/** The biggest file nobody has looked at and nothing was flagged on — the
 * place an unnoticed problem is most likely to still be sitting. */
function unreadFile(
  run: AgentRun | undefined,
  review: PendingReview | null,
  files: readonly FileChange[],
): FileChange | null {
  const viewed = new Set(review?.viewedFiles ?? []);
  const flagged = new Set(openFindings(run).map((f) => f.path));
  // `analyzableFiles` rather than a local `!isGenerated`: it also drops
  // binaries and files with no patch, and this chip's whole job is naming
  // something the reviewer can read and the agent can answer about.
  const candidates = analyzableFiles([...files]).filter(
    (f) => !viewed.has(f.path) && !flagged.has(f.path),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((biggest, f) =>
    f.additions + f.deletions > biggest.additions + biggest.deletions
      ? f
      : biggest,
  );
}

const MAX_OPENERS = 4;

export function chatOpeners(input: {
  run: AgentRun | undefined;
  review: PendingReview | null;
  files: readonly FileChange[];
  /** Set when the conversation is scoped to one finding — a different set of
   * questions entirely, because the subject is already chosen. */
  finding: Finding | null;
}): ChatOpener[] {
  const out: ChatOpener[] = [];

  if (input.finding) {
    const f = input.finding;
    out.push({
      id: "why",
      label: `Why is this a ${f.severity}?`,
      question: `Why is "${f.title}" a ${f.severity} rather than a lower severity? Point at the specific lines that make it one.`,
    });
    out.push({
      id: "drop",
      label: "What would change your mind?",
      question:
        "What would I have to show you to make you drop this finding? Be concrete about which code you would need to see.",
    });
    out.push({
      id: "reword",
      label: "Reword it in my voice",
      question:
        "Reword this as a comment I would post: shorter, direct, no hedging, and it should ask for something specific. Propose it as a revision.",
    });
    if (f.suggestion === undefined)
      out.push({
        id: "suggest",
        label: "Write the fix",
        question:
          "Write the actual fix as an exact replacement for these lines, and propose it as a suggestion on this finding.",
      });
    return out.slice(0, MAX_OPENERS);
  }

  const run = input.run;
  const findings = openFindings(run);
  const blockers = findings.filter((f) => f.severity === "blocker");

  if (!run || run.status !== "ready") {
    out.push({
      id: "first",
      label: "What should I look at first?",
      question:
        "You have the diff. Where should I start reading, and why? Name files and lines.",
    });
    out.push({
      id: "risk",
      label: "Anything risky here?",
      question:
        "Read the diff and tell me the riskiest thing in it. If nothing is risky, say that plainly.",
    });
  }

  if (blockers.length > 0) {
    const first = blockers[0];
    out.push({
      id: "blocker",
      label: `Why is "${first.title}" a blocker?`,
      question: `Why is "${first.title}" (${first.path}:${first.endLine}) a blocker rather than a risk? What breaks, and for which input?`,
    });
  }

  if (run?.status === "ready" && run.score !== undefined && run.score < 90) {
    out.push({
      id: "score",
      label: `What takes this from ${run.score} to green?`,
      question: `You scored this ${run.score}/100. List, in order, what would have to change for it to score 90+. Be specific about files and lines.`,
    });
  }

  if (run?.status === "ready" && findings.length === 0) {
    out.push({
      id: "notflagged",
      label: "What did you not flag?",
      question:
        "You flagged nothing. What did you consider and deliberately decide not to raise, and why?",
    });
  }

  const staged = input.review?.comments.length ?? 0;
  if (staged > 0) {
    out.push({
      id: "draft",
      label: `Read back my ${staged} staged comment${staged === 1 ? "" : "s"}`,
      question:
        "Read my staged comments back to me as the author of this PR would read them. Do they land? Is any of them unclear, unfair, or asking for something I did not actually say?",
    });
  }

  const unread = unreadFile(run, input.review, input.files);
  if (unread)
    out.push({
      id: "unread",
      label: `Is ${fileName(unread.path)} worth reading closely?`,
      question: `I have not read ${unread.path} yet (+${unread.additions} −${unread.deletions}). Is there anything in it I should slow down for, or can I skim it?`,
    });

  return out.slice(0, MAX_OPENERS);
}
