// Bun stores `bun build --compile` outputs under a virtual filesystem rooted
// at /$bunfs/. `import.meta.url` for any file inside the binary starts with
// `file:///$bunfs/`. This is undocumented Bun internals — if Bun changes the
// prefix in a future release, this helper is the single point to update.
const BUNFS_PREFIX = 'file:///$bunfs/';

export function isCompiledBun(): boolean {
  return import.meta.url.startsWith(BUNFS_PREFIX);
}

// Path of the worker entrypoint when compiled. Both entries (`app.ts`,
// `worker.ts`) are passed to `bun build --compile`; the second is stored at
// /$bunfs/root/<basename>.js.
export const COMPILED_WORKER_PATH = '/$bunfs/root/worker.js';
