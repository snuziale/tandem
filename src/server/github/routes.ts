// Dispatch for /api/prs/:owner/:repo/:number[/action]. Detail and files land
// in later milestones; approve is here from the start because the queue's
// quick action needs it.
import { API_PATHS } from '../../shared/api-paths';
import type { PrRef } from '../../shared/gh/prKey';
import { loadConfig } from '../config/store';
import { GitHubError } from './client';
import { fetchPrFiles } from './files';
import { fetchPrDetail } from './pr';
import { quickApprove } from './submit';

export async function handlePrs(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = parsePrPath(url.pathname);
  if (!parsed) return new Response('Not Found', { status: 404 });
  const { ref, action } = parsed;

  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: 'unconfigured' }, { status: 503 });

  try {
    if (action === '' && req.method === 'GET') {
      const detail = await fetchPrDetail(cfg, ref, req.signal);
      if (!detail) return Response.json({ error: 'pull request not found' }, { status: 404 });
      return Response.json(detail);
    }
    if (action === '/files' && req.method === 'GET') {
      return Response.json({ files: await fetchPrFiles(cfg, ref, req.signal) });
    }
    if (action === '/approve' && req.method === 'POST') {
      const result = await quickApprove(cfg.github, ref);
      return Response.json({ ok: true, ...result });
    }
    return new Response('Not Found', { status: 404 });
  } catch (e) {
    if (e instanceof GitHubError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** `/api/prs/<owner>/<repo>/<number>[/action]` → ref + action ('' or '/x'). */
export function parsePrPath(pathname: string): { ref: PrRef; action: string } | null {
  const prefix = `${API_PATHS.PRS}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split('/');
  if (segments.length < 3) return null;
  const [owner, repo, numberRaw, ...rest] = segments;
  const number = Number(numberRaw);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) return null;
  return {
    ref: { owner: decodeURIComponent(owner), repo: decodeURIComponent(repo), number },
    action: rest.length ? `/${rest.join('/')}` : '',
  };
}
