import { useQuery } from "@tanstack/react-query";
import { fetchAgentActivity } from "../api/runs";

/** Fast enough that a step change is visible; only while work is in flight. */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 30_000;

/**
 * What the agent is doing right now — the header strip and its tray.
 *
 * Separate from `useAgentRuns` because the two have opposite shapes: this
 * response is a handful of in-flight rows and three integers, so polling it
 * every 2s costs almost nothing, while the runs snapshot grows with every
 * review ever done. The server reconciles the live registry against the run
 * records (shared/agent-activity.ts), so every consumer gets one answer.
 */
export function useAgentActivity() {
  return useQuery({
    // Keyed UNDER ["runs"] on purpose: every existing
    // invalidateQueries({ queryKey: ["runs"] }) — starting a run, cancelling
    // one, applying a chat action, a finished SSE stream — matches by prefix
    // and refreshes the strip too, so none of those call sites has to know
    // this query exists.
    queryKey: ["runs", "activity"],
    queryFn: fetchAgentActivity,
    refetchInterval: (query) =>
      query.state.data?.work.length ? LIVE_POLL_MS : IDLE_POLL_MS,
  });
}
