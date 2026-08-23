// The metadata type carried by every @pierre/diffs annotation Tandem renders
// inline in the diff. One union across milestones: human threads, the line
// composer, and agent findings all land as diff-line annotations.
import type { PendingComment, ReviewThread } from "../../shared/review-types";
import type { Finding } from "../../shared/agent-types";

export type TandemAnno =
  | { kind: "thread"; thread: ReviewThread }
  | { kind: "composer" }
  | { kind: "pending"; comment: PendingComment }
  | { kind: "finding"; finding: Finding };

/** GitHub side → @pierre/diffs annotation side. */
export function annotationSideOf(
  side: "LEFT" | "RIGHT",
): "deletions" | "additions" {
  return side === "LEFT" ? "deletions" : "additions";
}

export function diffSideOf(side: "deletions" | "additions"): "LEFT" | "RIGHT" {
  return side === "deletions" ? "LEFT" : "RIGHT";
}
