import { API_PATHS } from "../../shared/api-paths";
import { parseRepoKey } from "../../shared/gh/prKey";
import { isPlainObject } from "../../shared/is-plain-object";
import { checkClone } from "../agent/worktree";
import { parseJsonBody } from "../requestJson";
import { loadSettings, saveSettings } from "./store";

export async function handleSettings(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === API_PATHS.SETTINGS_CHECK_CLONE) {
    if (req.method !== "POST")
      return new Response("Method Not Allowed", { status: 405 });
    const body = await parseJsonBody(req);
    const repo = isPlainObject(body) ? body.repo : undefined;
    const path = isPlainObject(body) ? body.path : undefined;
    const ref = typeof repo === "string" ? parseRepoKey(repo) : null;
    if (!ref || typeof path !== "string" || !path.trim())
      return Response.json(
        { error: "expected { repo: owner/name, path }" },
        { status: 400 },
      );
    // Runs git rev-parse / remote -v only — nothing is fetched or written.
    return Response.json(await checkClone(path.trim(), ref));
  }
  if (url.pathname !== API_PATHS.SETTINGS)
    return new Response("Not Found", { status: 404 });

  if (req.method === "GET")
    return Response.json({ settings: await loadSettings() });

  if (req.method === "PUT") {
    const body = await parseJsonBody(req);
    if (body === undefined)
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    // Merge over current so the client can PUT partial updates.
    const current = await loadSettings();
    const settings = await saveSettings({
      ...current,
      ...(typeof body === "object" ? body : {}),
    });
    return Response.json({ settings });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
