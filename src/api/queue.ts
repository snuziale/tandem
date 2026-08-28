import { API_PATHS } from "../shared/api-paths";
import type { QueueResult, SavedView } from "../shared/review-types";
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
