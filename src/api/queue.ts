import { API_PATHS } from '../shared/api-paths';
import type { QueueResult, SavedView } from '../shared/review-types';
import { apiRequest } from './http';

export function fetchQueue(views: SavedView[], signal?: AbortSignal): Promise<QueueResult> {
  return apiRequest<QueueResult>(API_PATHS.QUEUE, {
    method: 'POST',
    body: { views: views.map((v) => ({ id: v.id, query: v.query })) },
    signal,
  });
}
