import { API_PATHS } from '../shared/api-paths';
import { parsePrId } from '../shared/gh/prKey';
import type { PrId } from '../shared/review-types';
import { apiRequest } from './http';

export function prApiBase(prId: PrId): string {
  const ref = parsePrId(prId);
  if (!ref) throw new Error(`malformed prId: ${prId}`);
  return `${API_PATHS.PRS}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${ref.number}`;
}

export function approvePr(prId: PrId): Promise<{ ok: true; url: string }> {
  return apiRequest<{ ok: true; url: string }>(`${prApiBase(prId)}/approve`, { method: 'POST' });
}
