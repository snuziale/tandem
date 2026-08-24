import { GITHUB_CREDENTIAL_FIELDS } from "../../shared/github-credentials";
import type { ConfigStatus } from "../../shared/config-types";
import { API_PATHS } from "../../shared/api-paths";
import { isPlainObject } from "../../shared/is-plain-object";
import { testGitHubCredentials } from "../github/client";
import { parseJsonBody } from "../requestJson";
import { loadConfig, saveConfig, configPath, type Config } from "./store";
import { validateConfig } from "./validate";

export async function handleConfig(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === API_PATHS.CONFIG_STATUS && req.method === "GET")
    return handleStatus();
  if (url.pathname === API_PATHS.CONFIG_TEST && req.method === "POST")
    return handleTest(req);
  if (
    url.pathname === API_PATHS.CONFIG &&
    (req.method === "POST" || req.method === "PUT")
  ) {
    return handleSave(req);
  }
  return new Response("Not Found", { status: 404 });
}

// The authenticated login, probed lazily so /api/config/status stays fast and
// works offline. A failed probe retries at most every 60s; a save resets it.
let cachedLogin: string | null = null;
let lastProbeAt = 0;

export async function resolveLogin(): Promise<string | null> {
  if (cachedLogin) return cachedLogin;
  const cfg = await loadConfig();
  if (!cfg) return null;
  const now = Date.now();
  if (now - lastProbeAt < 60_000) return null;
  lastProbeAt = now;
  const result = await testGitHubCredentials(cfg.github);
  cachedLogin = result.ok ? result.login : null;
  return cachedLogin;
}

async function handleStatus(): Promise<Response> {
  const cfg = await loadConfig();
  return Response.json({
    configured: !!cfg,
    login: cfg ? await resolveLogin() : null,
    fields: GITHUB_CREDENTIAL_FIELDS,
    configPath: configPath(),
    currentValues: cfg ? redactedCurrentValues(cfg) : undefined,
  } satisfies ConfigStatus);
}

// Never echo secrets back to the browser. Non-secret fields are populated so
// the user can see what's currently stored.
function redactedCurrentValues(cfg: Config): Record<string, string> {
  const creds = cfg.github as unknown as Record<string, string>;
  const out: Record<string, string> = {};
  for (const field of GITHUB_CREDENTIAL_FIELDS) {
    out[field.key] = field.secret ? "" : (creds[field.key] ?? "");
  }
  return out;
}

async function handleTest(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (
    !isPlainObject(body) ||
    !isPlainObject(body.creds) ||
    typeof body.creds.token !== "string"
  ) {
    return Response.json(
      { ok: false, message: "expected { creds: { token } }" },
      { status: 400 },
    );
  }
  return Response.json(
    await testGitHubCredentials({
      token: body.creds.token,
      defaultOrg:
        typeof body.creds.defaultOrg === "string" ? body.creds.defaultOrg : "",
    }),
  );
}

async function handleSave(req: Request): Promise<Response> {
  const raw = await parseJsonBody(req);
  if (raw === undefined)
    return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const candidate =
    req.method === "PUT" ? await mergeWithExistingSecrets(raw) : raw;
  const result = validateConfig(candidate);
  if (!result.ok)
    return Response.json({ error: result.reason }, { status: 400 });
  await saveConfig(result.value);
  cachedLogin = null;
  lastProbeAt = 0;
  return Response.json({ ok: true });
}

// On PUT, a blank secret field means "keep the stored value" — that's how the
// rotation form signals "I'm only changing non-secrets".
async function mergeWithExistingSecrets(raw: unknown): Promise<unknown> {
  if (!isPlainObject(raw) || !isPlainObject(raw.github)) return raw;
  const existing = await loadConfig();
  if (!existing) return raw;
  const incoming = raw.github as Record<string, string>;
  const merged: Record<string, string> = { ...incoming };
  for (const field of GITHUB_CREDENTIAL_FIELDS) {
    if (field.secret && !merged[field.key]) {
      merged[field.key] =
        (existing.github as unknown as Record<string, string>)[field.key] ?? "";
    }
  }
  return { github: merged };
}
