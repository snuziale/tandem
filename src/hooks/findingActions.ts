// Finding triage actions shared by the inline cards, the agent pane, and the
// keyboard handlers. Accepting a finding stages the exact comment the human
// would post; the agent itself never touches GitHub.
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { setFindingState } from "../api/runs";
import type { Finding } from "../shared/agent-types";
import type { PendingComment } from "../shared/review-types";

/** The staged comment body for a finding — title bolded, body verbatim. */
export function commentBodyOf(finding: Finding): string {
  return `**${finding.title}**\n\n${finding.body}`;
}

export function pendingCommentOf(
  finding: Finding,
  bodyOverride?: string,
): Omit<PendingComment, "localId"> {
  return {
    findingId: finding.id,
    path: finding.path,
    line: finding.endLine,
    startLine: finding.startLine,
    side: finding.side,
    body: bodyOverride ?? commentBodyOf(finding),
    suggestion: finding.suggestion,
  };
}

export async function acceptFinding(
  queryClient: QueryClient,
  finding: Finding,
  addComment: (comment: Omit<PendingComment, "localId">) => void,
  opts: { editedBody?: string } = {},
): Promise<void> {
  try {
    if (
      opts.editedBody !== undefined &&
      opts.editedBody !== commentBodyOf(finding)
    ) {
      await setFindingState(finding.runId, finding.id, "edited");
    }
    addComment(pendingCommentOf(finding, opts.editedBody));
    await setFindingState(finding.runId, finding.id, "staged");
  } catch (e) {
    toast.error("Could not stage finding", {
      description: e instanceof Error ? e.message : undefined,
    });
  } finally {
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }
}

export async function dismissFinding(
  queryClient: QueryClient,
  finding: Finding,
): Promise<void> {
  try {
    await setFindingState(finding.runId, finding.id, "dismissed");
  } catch (e) {
    toast.error("Could not dismiss finding", {
      description: e instanceof Error ? e.message : undefined,
    });
  } finally {
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }
}

/** Un-stage: the draft comment is being removed; return the finding to proposed. */
export async function unstageFinding(
  queryClient: QueryClient,
  runId: string,
  findingId: string,
): Promise<void> {
  try {
    await setFindingState(runId, findingId, "proposed");
  } catch {
    // Already posted/stale — nothing to restore.
  } finally {
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }
}
