import { useQuery } from '@tanstack/react-query';
import { fetchRuns } from '../api/runs';
import type { AgentRun } from '../shared/agent-types';
import { runKeyOf } from '../shared/gh/prKey';
import type { PrId } from '../shared/review-types';

/** All agent-run records, indexed by (prId, headSha). Queue + detail share it. */
export function useAgentRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: fetchRuns,
    refetchInterval: 30_000,
    select: (runs) => {
      const byKey = new Map<string, AgentRun>();
      for (const run of runs) byKey.set(runKeyOf(run.prId, run.headSha), run);
      return byKey;
    },
  });
}

export function runFor(byKey: Map<string, AgentRun> | undefined, prId: PrId, headSha: string | undefined): AgentRun | undefined {
  if (!byKey || !headSha) return undefined;
  return byKey.get(runKeyOf(prId, headSha));
}
