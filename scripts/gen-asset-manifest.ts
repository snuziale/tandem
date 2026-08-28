// Scans dist/ (the vite build output) and emits src/server/asset-manifest.ts,
// so the server reads assets from the same map whether it is running from the
// filesystem or from a `bun build --compile` binary. The path and text handling
// lives in ./asset-manifest.ts, where it is tested; this file is the I/O.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManifest, walk } from './asset-manifest.ts';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const DIST_DIR = join(ROOT, 'dist');
const OUT_PATH = join(ROOT, 'src/server/asset-manifest.ts');

let files: string[];
try {
  files = walk(DIST_DIR).sort();
} catch {
  console.warn(`[asset-manifest] ${DIST_DIR} not found — writing empty stub. Run \`vite build\` first.`);
  files = [];
}

await Bun.write(OUT_PATH, renderManifest(files));
console.log(`[asset-manifest] wrote ${files.length} entries → ${OUT_PATH}`);
