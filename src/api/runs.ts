import { API_PATHS } from "../shared/api-paths";
import type { TodayTally } from "../shared/agent-activity";
import type {
  AgentRun,
  FindingState,
  LiveWork,
  RunEvent,
} from "../shared/agent-types";
import type { PrId } from "../shared/review-types";
import { apiRequest } from "./http";

export type RunsSnapshot = {
  runs: AgentRun[];
  spendTodayUsd: number;
  /** Runs only — chat turns are live work but not run accounting. */
  liveCount: number;
};

export function fetchRuns(): Promise<RunsSnapshot> {
  return apiRequest<RunsSnapshot>(API_PATHS.RUNS);
}

/**
 * What the agent is doing right now. Its own endpoint, not a field on the runs
 * snapshot: the header polls this every 2s while work is live, and the runs
 * snapshot grows with review history.
 */
export type AgentActivity = {
  /** Everything in flight, runs and chat turns alike, newest first. */
  work: LiveWork[];
  today: TodayTally;
  spendTodayUsd: number;
};

export function fetchAgentActivity(): Promise<AgentActivity> {
  return apiRequest<AgentActivity>(API_PATHS.RUNS_ACTIVITY);
}

export function startRun(
  prId: PrId,
  force = false,
  agentId?: string,
): Promise<{ run: AgentRun; started: boolean }> {
  return apiRequest<{ run: AgentRun; started: boolean }>(
    `${API_PATHS.RUNS}/start`,
    { method: "POST", body: { prId, force, agentId } },
  );
}

export function cancelRun(runId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    `${API_PATHS.RUNS}/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
}

export function setFindingState(
  runId: string,
  findingId: string,
  state: FindingState,
): Promise<{ run: AgentRun }> {
  return apiRequest<{ run: AgentRun }>(
    `${API_PATHS.RUNS}/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}`,
    {
      method: "POST",
      body: { state },
    },
  );
}

export function fetchAgentHealth(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  return apiRequest(`${API_PATHS.AGENT_HEALTH}`);
}

/** Live run stream. Returns the EventSource; caller closes it. */
export function openRunStream(
  runId: string,
  onEvent: (event: RunEvent) => void,
): EventSource {
  const source = new EventSource(
    `${API_PATHS.RUNS}/${encodeURIComponent(runId)}/stream`,
  );
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      // malformed frame — skip
    }
  };
  return source;
}
