import { API_PATHS } from '../shared/api-paths';
import type { AgentRun, FindingState, RunEvent } from '../shared/agent-types';
import type { PrId } from '../shared/review-types';
import { apiRequest } from './http';

export async function fetchRuns(): Promise<AgentRun[]> {
  const { runs } = await apiRequest<{ runs: AgentRun[] }>(API_PATHS.RUNS);
  return runs;
}

export function startRun(prId: PrId, force = false): Promise<{ run: AgentRun; started: boolean }> {
  return apiRequest<{ run: AgentRun; started: boolean }>(`${API_PATHS.RUNS}/start`, { method: 'POST', body: { prId, force } });
}

export function cancelRun(runId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`${API_PATHS.RUNS}/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export function setFindingState(runId: string, findingId: string, state: FindingState): Promise<{ run: AgentRun }> {
  return apiRequest<{ run: AgentRun }>(`${API_PATHS.RUNS}/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}`, {
    method: 'POST',
    body: { state },
  });
}

export function fetchAgentHealth(): Promise<{ available: boolean; version?: string; error?: string }> {
  return apiRequest(`${API_PATHS.AGENT_HEALTH}`);
}

/** Live run stream. Returns the EventSource; caller closes it. */
export function openRunStream(runId: string, onEvent: (event: RunEvent) => void): EventSource {
  const source = new EventSource(`${API_PATHS.RUNS}/${encodeURIComponent(runId)}/stream`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      // malformed frame — skip
    }
  };
  return source;
}
