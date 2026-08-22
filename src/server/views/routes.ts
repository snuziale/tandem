import { API_PATHS } from '../../shared/api-paths';
import type { SavedView } from '../../shared/review-types';
import { parseJsonBody } from '../requestJson';
import { loadViews, saveViews, validateView } from './store';

export async function handleViews(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== API_PATHS.VIEWS) return new Response('Not Found', { status: 404 });

  if (req.method === 'GET') {
    return Response.json({ views: await loadViews() });
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || !Array.isArray((body as { views?: unknown }).views)) {
      return Response.json({ error: 'expected { views: SavedView[] }' }, { status: 400 });
    }
    const views = (body as { views: unknown[] }).views.map(validateView);
    if (views.some((v) => v === null)) {
      return Response.json({ error: 'invalid view (id, name, query are required)' }, { status: 400 });
    }
    await saveViews(views as SavedView[]);
    return Response.json({ views: await loadViews() });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
