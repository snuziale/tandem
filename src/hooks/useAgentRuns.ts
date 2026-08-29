import { useQuery } from "@tanstack/react-query";
import { fetchRuns } from "../api/runs";
import type { AgentRun } from "../shared/agent-types";
import { runKeyOf } from "../shared/gh/prKey";
import type { PrId } from "../shared/review-types";

export type RunsIndex = {
  byKey: Map<string, AgentRun>;
  /** Every run, in the order the server sent them. The PR pane reads it to
   * find reviews of EARLIER commits of the PR it is showing — those records
   * are kept on purpose (spec §2 keeps stale runs and their findings), and
   * `byKey` can only answer for the sha you already named. */
  all: AgentRun[];
  spendTodayUsd: number;
};

/**
 * All agent-run records indexed by (prId, headSha). Queue, PR detail, the
 * agent tray's history list and settings all share it.
 *
 * Stays on a SLOW poll on purpose: this response carries every run with its
 * findings and steps, and `select` rebuilds the index for each subscribing
 * component. What the agent is doing right now lives in useAgentActivity,
 * which is small enough to poll hard.
 */
export function useAgentRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 30_000,
    select: (snapshot): RunsIndex => {
      const byKey = new Map<string, AgentRun>();
      for (const run of snapshot.runs)
        byKey.set(runKeyOf(run.prId, run.headSha), run);
      return {
        byKey,
        all: snapshot.runs,
        spendTodayUsd: snapshot.spendTodayUsd,
      };
    },
  });
}

export function runFor(
  index: RunsIndex | undefined,
  prId: PrId,
  headSha: string | undefined,
): AgentRun | undefined {
  if (!index || !headSha) return undefined;
  return index.byKey.get(runKeyOf(prId, headSha));
}

/** True when the run has a live blocker the reviewer hasn't dismissed. */
export function hasOpenBlocker(run: AgentRun | undefined): boolean {
  return (
    !!run &&
    run.status === "ready" &&
    run.findings.some(
      (f) => f.severity === "blocker" && f.state !== "dismissed",
    )
  );
}
