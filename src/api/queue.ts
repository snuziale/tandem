import { API_PATHS } from "../shared/api-paths";
import type {
  ChecksResult,
  PullRequest,
  QueueResult,
  SavedView,
} from "../shared/review-types";
import { apiRequest } from "./http";

export function fetchQueue(
  views: SavedView[],
  signal?: AbortSignal,
): Promise<QueueResult> {
  return apiRequest<QueueResult>(API_PATHS.QUEUE, {
    method: "POST",
    body: {
      views: views.map((v) => ({
        id: v.id,
        query: v.query,
        agentEnabled: v.agentEnabled,
        // The server owns {team} expansion and sharding — the client only
        // says which team the view's token refers to.
        teamId: v.teamId,
      })),
    },
    signal,
  });
}

/**
 * The second checks request. Deliberately separate from `fetchQueue`: the
 * table must paint from the search alone, and this refines it a couple of
 * seconds later (server/github/checks.ts explains why it can't ride along).
 */
export function fetchQueueChecks(
  prs: PullRequest[],
  signal?: AbortSignal,
): Promise<ChecksResult> {
  return apiRequest<ChecksResult>(API_PATHS.QUEUE_CHECKS, {
    method: "POST",
    body: {
      prs: prs.map((pr) => ({
        prId: pr.prId,
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
      })),
    },
    signal,
  });
}
