import { API_PATHS } from '../shared/api-paths';
import type { PrId, SeenRecord } from '../shared/review-types';
import { apiRequest } from './http';

export async function fetchSeen(): Promise<Record<string, SeenRecord>> {
  const { seen } = await apiRequest<{ seen: Record<string, SeenRecord> }>(API_PATHS.SEEN);
  return seen;
}

export function putSeen(prId: PrId, updatedAt: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`${API_PATHS.SEEN}/${encodeURIComponent(prId)}`, { method: 'PUT', body: { updatedAt } });
}
