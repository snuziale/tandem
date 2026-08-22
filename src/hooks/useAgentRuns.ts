import { useQuery } from '@tanstack/react-query';
import { fetchRuns } from '../api/runs';
import type { AgentRun } from '../shared/agent-types';
import { runKeyOf } from '../shared/gh/prKey';
import type { PrId } from '../shared/review-types';

export type RunsIndex = {
  byKey: Map<string, AgentRun>;
  spendTodayUsd: number;
  liveCount: number;
};

/** All agent-run records indexed by (prId, headSha), plus the agent status
 * strip's numbers. Queue, detail, top bar, and settings all share it. */
export function useAgentRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: fetchRuns,
    refetchInterval: 30_000,
    select: (snapshot): RunsIndex => {
      const byKey = new Map<string, AgentRun>();
      for (const run of snapshot.runs) byKey.set(runKeyOf(run.prId, run.headSha), run);
      return { byKey, spendTodayUsd: snapshot.spendTodayUsd, liveCount: snapshot.liveCount };
    },
  });
}

export function runFor(index: RunsIndex | undefined, prId: PrId, headSha: string | undefined): AgentRun | undefined {
  if (!index || !headSha) return undefined;
  return index.byKey.get(runKeyOf(prId, headSha));
}

/** True when the run has a live blocker the reviewer hasn't dismissed. */
export function hasOpenBlocker(run: AgentRun | undefined): boolean {
  return !!run && run.status === 'ready' && run.findings.some((f) => f.severity === 'blocker' && f.state !== 'dismissed');
}
