// PURE run/skip decisions (Sift schedule.ts discipline: every decision the
// scheduler or pipeline makes lives here, testable without I/O).
//
// In SHARED, not under the pipeline, because it has two readers now: the
// server, which skips a run, and the PR pane's pre-flight card, which tells
// the reviewer BEFORE they click that this PR would be skipped and why. A
// second copy of these rules on the client would be a promise the server had
// no reason to keep.
import type { SkipReason } from "./agent-types";
import type { TandemSettings } from "./settings-types";

export type SkipInput = {
  isDraft: boolean;
  changedFiles: number;
  diffLines: number;
  /** Every changed file is generated/lockfile/binary. */
  allGenerated: boolean;
  agentEnabled: boolean;
  /** Today's agent spend so far, USD. */
  spentTodayUsd: number;
};

export type SkipDecision = { skip: true; reason: SkipReason } | { skip: false };

export function skipDecision(
  input: SkipInput,
  settings: TandemSettings,
): SkipDecision {
  if (!input.agentEnabled) return { skip: true, reason: "agent-disabled" };
  if (settings.skipDrafts && input.isDraft)
    return { skip: true, reason: "draft" };
  if (input.changedFiles > settings.maxChangedFiles)
    return { skip: true, reason: "too-many-files" };
  if (input.diffLines > settings.maxDiffLines)
    return { skip: true, reason: "diff-too-large" };
  if (input.allGenerated) return { skip: true, reason: "generated-only" };
  if (input.spentTodayUsd >= settings.dailyCostUsd)
    return { skip: true, reason: "budget" };
  return { skip: false };
}
