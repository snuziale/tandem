import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentRun, RunEvent } from "../shared/agent-types";
import { openRunStream } from "../api/runs";

const ACTIVE: ReadonlyArray<AgentRun["status"]> = [
  "queued",
  "fetching",
  "analyzing",
];

export function isRunActive(run: AgentRun | undefined): boolean {
  return !!run && ACTIVE.includes(run.status);
}

/** Follow a live run over SSE: exposes the latest progress event and refreshes
 * the runs query when the run finishes. Closing the pane just detaches —
 * the run is server-owned. */
export function useRunStream(run: AgentRun | undefined) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RunEvent | null>(null);
  const runId = run && isRunActive(run) ? run.id : null;

  useEffect(() => {
    if (!runId) return;
    const source = openRunStream(runId, (event) => {
      if (event.type === "done" || event.type === "error") {
        queryClient.invalidateQueries({ queryKey: ["runs"] });
        if (event.type === "done") source.close();
      } else {
        setProgress(event);
      }
    });
    source.onerror = () => {
      // Stream broke (server restart, network) — fall back to polling.
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    };
    return () => source.close();
  }, [runId, queryClient]);

  return runId ? progress : null;
}
