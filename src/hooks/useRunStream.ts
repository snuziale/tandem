import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentRun, RunEvent, RunStep } from "../shared/agent-types";
import { openRunStream } from "../api/runs";

const ACTIVE: ReadonlyArray<AgentRun["status"]> = [
  "queued",
  "fetching",
  "analyzing",
];

export function isRunActive(run: AgentRun | undefined): boolean {
  return !!run && ACTIVE.includes(run.status);
}

/** What the pane knows about a run in flight, accumulated from the stream. */
export type RunProgress = {
  /** Ordered timeline, upserted by step id as each stage opens and settles. */
  steps: RunStep[];
  /** Pass-1 review plan, once pass 1 has answered. */
  plan: string[] | null;
  /** The plan is the generic fallback — pass 1's output was unusable. */
  planDegraded: boolean;
  tokens: number;
  costUsd: number;
};

const EMPTY: RunProgress = {
  steps: [],
  plan: null,
  planDegraded: false,
  tokens: 0,
  costUsd: 0,
};

function reduce(state: RunProgress, event: RunEvent): RunProgress {
  switch (event.type) {
    case "step": {
      const at = state.steps.findIndex((s) => s.id === event.step.id);
      const steps = [...state.steps];
      if (at === -1) steps.push(event.step);
      else steps[at] = event.step;
      return { ...state, steps };
    }
    case "plan":
      return {
        ...state,
        plan: event.checks,
        planDegraded: event.degraded === true,
      };
    case "usage":
      return { ...state, tokens: event.tokens, costUsd: event.costUsd };
    default:
      return state;
  }
}

/** Follow a live run over SSE: accumulates the run's timeline (replay-then-tail
 * means a pane opened mid-run gets the whole thing) and refreshes the runs query
 * when the run finishes. Closing the pane just detaches — the run is
 * server-owned. */
export function useRunStream(run: AgentRun | undefined): RunProgress | null {
  const queryClient = useQueryClient();
  // Keyed by runId rather than reset in an effect: clearing state from an
  // effect is exactly what the React Compiler lint rejects
  // (react-hooks/set-state-in-effect).
  const [tracked, setTracked] = useState<{
    runId: string;
    progress: RunProgress;
  } | null>(null);
  const runId = run && isRunActive(run) ? run.id : null;

  useEffect(() => {
    if (!runId) return;
    const source = openRunStream(runId, (event) => {
      if (event.type === "done" || event.type === "error") {
        queryClient.invalidateQueries({ queryKey: ["runs"] });
        if (event.type === "done") source.close();
        return;
      }
      setTracked((prev) => ({
        runId,
        progress: reduce(prev?.runId === runId ? prev.progress : EMPTY, event),
      }));
    });
    source.onerror = () => {
      // Stream broke (server restart, network) — fall back to polling.
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    };
    return () => source.close();
  }, [runId, queryClient]);

  if (!runId) return null;
  return tracked?.runId === runId ? tracked.progress : null;
}
