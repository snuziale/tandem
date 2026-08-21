// Body parsing for the `/api/*` handlers, alongside pathMatch.ts's path
// matching. Deliberately not a router dependency: route modules stay plain
// functions over Request, and this is the one place that decides what a
// malformed body looks like.

/**
 * The request's JSON body, or `undefined` when it isn't valid JSON (including
 * an empty body). Handlers reject on the value rather than on a throw, so a
 * malformed body is an ordinary 400 instead of an unhandled rejection.
 *
 * `undefined` is unambiguous: a body of literal `null` parses to `null`, so a
 * caller that needs to tell "no parseable body" from "explicit null" can.
 */
export async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
