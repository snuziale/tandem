import { API_PATHS } from '../../shared/api-paths';
import { parseJsonBody } from '../requestJson';
import { loadSettings, saveSettings } from './store';

export async function handleSettings(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== API_PATHS.SETTINGS) return new Response('Not Found', { status: 404 });

  if (req.method === 'GET') return Response.json({ settings: await loadSettings() });

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req);
    if (body === undefined) return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    // Merge over current so the client can PUT partial updates.
    const current = await loadSettings();
    const settings = await saveSettings({ ...current, ...(typeof body === 'object' ? body : {}) });
    return Response.json({ settings });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
