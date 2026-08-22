import { API_PATHS } from '../shared/api-paths';
import type { PendingReview, PrId } from '../shared/review-types';
import { apiRequest } from './http';

function reviewPath(prId: PrId): string {
  return `${API_PATHS.REVIEWS}/${encodeURIComponent(prId)}`;
}

export async function fetchReview(prId: PrId): Promise<PendingReview | null> {
  const { review } = await apiRequest<{ review: PendingReview | null }>(reviewPath(prId));
  return review;
}

export async function putReview(review: PendingReview): Promise<PendingReview> {
  const result = await apiRequest<{ review: PendingReview }>(reviewPath(review.prId), { method: 'PUT', body: review });
  return result.review;
}

export function deleteReview(prId: PrId): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(reviewPath(prId), { method: 'DELETE' });
}
