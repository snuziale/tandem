import { API_PATHS } from '../shared/api-paths';
import type { SavedView } from '../shared/review-types';
import { apiRequest } from './http';

export async function fetchViews(): Promise<SavedView[]> {
  const { views } = await apiRequest<{ views: SavedView[] }>(API_PATHS.VIEWS);
  return views;
}

export async function saveViews(views: SavedView[]): Promise<SavedView[]> {
  const result = await apiRequest<{ views: SavedView[] }>(API_PATHS.VIEWS, { method: 'PUT', body: { views } });
  return result.views;
}
