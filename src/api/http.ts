// Thin fetch wrapper for the Tandem server's /api/* routes. All client
// fetchers (queue, prs, reviews, runs, settings, views, config) go through
// this so error shaping and JSON handling live in one place.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

/** A response body that is NOT JSON — the file bodies `/blob` returns. Error
 * responses are still JSON, so failures shape exactly like `apiRequest`'s. */
export async function apiRequestText(
  path: string,
  opts: Pick<RequestOptions, "signal"> = {},
): Promise<string> {
  const res = await fetch(path, { signal: opts.signal });
  const text = await res.text();
  if (!res.ok) throw errorFrom(res, text);
  return text;
}

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal } = opts;
  const res = await fetch(path, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) throw errorFrom(res, text, parsed);

  return parsed as T;
}

function errorFrom(res: Response, text: string, parsed?: unknown): ApiError {
  let body = parsed;
  if (body === undefined && text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const message =
    (body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : undefined) ||
    res.statusText ||
    `HTTP ${res.status}`;
  return new ApiError(res.status, message, body);
}
