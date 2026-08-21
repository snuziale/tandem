// The one place Tandem talks to api.github.com. Auth header injection, the
// GraphQL POST helper, the REST helper, rate-limit surfacing, and the
// credential probe all live here — route handlers never build GitHub requests
// themselves.
import type { CredentialTestResult } from '../../shared/config-types';
import type { GitHubCreds } from '../../shared/github-schema';
import type { RateLimitInfo } from '../../shared/review-types';
import { PROXY_USER_AGENT } from '../../shared/user-agent';

const GITHUB_API = 'https://api.github.com';

export class GitHubError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders(creds: GitHubCreds, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': PROXY_USER_AGENT,
  };
}

function rateLimitFrom(res: Response): RateLimitInfo | null {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const limit = res.headers.get('x-ratelimit-limit');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining === null || limit === null) return null;
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : '',
  };
}

async function errorMessageFrom(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) detail = body.message;
  } catch {
    // non-JSON error body — status text is all we have
  }
  // Org-SSO tokens fail with a 403 that names the SAML enforcement — surface
  // that verbatim, it's the actionable part ("authorize the token for <org>").
  if (res.status === 403 && /saml|sso/i.test(detail)) {
    return `${detail} — authorize the token for the org at github.com/settings/tokens`;
  }
  return detail || `${res.status} ${res.statusText}`;
}

export type RestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Override the Accept header (e.g. 'application/vnd.github.diff'). */
  accept?: string;
  signal?: AbortSignal;
};

export type RestResult<T> = { data: T; rateLimit: RateLimitInfo | null; response: Response };

/** REST call. `path` starts with `/` (e.g. `/repos/o/r/pulls/1/files?page=2`). */
export async function rest<T>(creds: GitHubCreds, path: string, opts: RestOptions = {}): Promise<RestResult<T>> {
  const { method = 'GET', body, accept, signal } = opts;
  const headers = authHeaders(creds, accept);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw new GitHubError(res.status, await errorMessageFrom(res), undefined);
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const data = (isJson ? await res.json() : await res.text()) as T;
  return { data, rateLimit: rateLimitFrom(res), response: res };
}

type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string; type?: string }> };

export async function graphql<T>(
  creds: GitHubCreds,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<{ data: T; rateLimit: RateLimitInfo | null }> {
  const res = await fetch(`${GITHUB_API}/graphql`, {
    method: 'POST',
    headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!res.ok) throw new GitHubError(res.status, await errorMessageFrom(res), undefined);
  const payload = (await res.json()) as GraphQLResponse<T>;
  // GraphQL can return partial data + errors (e.g. one inaccessible repo in a
  // search). Treat it as fatal only when there is no data at all.
  if (!payload.data) {
    const message = payload.errors?.map((e) => e.message).join('; ') || 'GraphQL request failed';
    throw new GitHubError(res.status, message, payload.errors);
  }
  if (payload.errors?.length) {
    console.error(`[github] partial GraphQL errors: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  return { data: payload.data, rateLimit: rateLimitFrom(res) };
}

/** Probe the token via GET /user. Returns the authenticated login on success —
 * the identity reviews will post as. */
export async function testGitHubCredentials(creds: GitHubCreds): Promise<CredentialTestResult> {
  try {
    const { data } = await rest<{ login: string }>(creds, '/user');
    return { ok: true, login: data.login };
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 401) return { ok: false, message: 'GitHub rejected the token (401 Unauthorized)' };
      return { ok: false, message: e.message };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'network error reaching api.github.com' };
  }
}
