// Route path matching for the `/api/<collection>/<id>[/action]` endpoints.
// Deliberately not a router dependency: every handler stays a plain list of
// exact-path checks plus this one matcher for the id-bearing paths.

/**
 * `<base>/<id>[<rest>]` → `{ id, rest }`, where `rest` is `''` or starts with
 * `/` (`'/cancel'`, `'/stream'`, …). Null when the base doesn't match, the id
 * segment is empty, or the id isn't valid percent-encoding.
 *
 * `id` is the first path segment only, so a caller checking `rest === '/run'`
 * can't be fooled by an id containing slashes.
 */
export function matchIdPath(pathname: string, base: string): { id: string; rest: string } | null {
  const prefix = `${base}/`;
  if (!pathname.startsWith(prefix)) return null;
  const tail = pathname.slice(prefix.length);
  const slash = tail.indexOf('/');
  const raw = slash === -1 ? tail : tail.slice(0, slash);
  if (!raw) return null;
  try {
    return { id: decodeURIComponent(raw), rest: slash === -1 ? '' : tail.slice(slash) };
  } catch {
    return null; // malformed escape sequence — no such id
  }
}
