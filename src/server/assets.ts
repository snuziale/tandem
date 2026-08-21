import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST } from './asset-manifest';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME[pathname.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

// Empty manifest = running unbundled (tsc/dev) before scripts/gen-asset-manifest
// has been executed. Fall back to reading dist/ from the local filesystem so
// `bun src/server/worker.ts` works straight after `vite build`.
const useDiskFallback = Object.keys(ASSET_MANIFEST).length === 0;
const DIST_ON_DISK = useDiskFallback ? join(fileURLToPath(import.meta.url), '../../../dist') : null;

function fileForPath(target: string): string | null {
  const fromManifest = ASSET_MANIFEST[target];
  if (fromManifest) return fromManifest;
  if (DIST_ON_DISK) return join(DIST_ON_DISK, target);
  return null;
}

async function readOr404(filePath: string | null): Promise<{ file: ReturnType<typeof Bun.file> } | null> {
  if (!filePath) return null;
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return { file };
}

export async function serveAsset(pathname: string): Promise<Response> {
  const target = pathname === '/' || !pathname.includes('.') ? '/index.html' : pathname;
  const direct = await readOr404(fileForPath(target));
  if (direct) {
    return new Response(direct.file, { headers: { 'content-type': contentTypeFor(target) } });
  }
  // SPA fallback for client-side routes (/:owner/:repo/pull/:n, /settings).
  const index = await readOr404(fileForPath('/index.html'));
  if (index) {
    return new Response(index.file, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response('Not Found', { status: 404 });
}
