import { API_PATHS } from "../../shared/api-paths";
import { isPlainObject } from "../../shared/isPlainObject";
import { matchIdPath } from "../pathMatch";
import { parseJsonBody } from "../requestJson";
import { loadSeen, markSeen } from "./store";

export async function handleSeen(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === API_PATHS.SEEN && req.method === "GET") {
    return Response.json({ seen: await loadSeen() });
  }

  const match = matchIdPath(url.pathname, API_PATHS.SEEN);
  if (match && match.rest === "" && req.method === "PUT") {
    const body = await parseJsonBody(req);
    if (!isPlainObject(body) || typeof body.updatedAt !== "string") {
      return Response.json(
        { error: "expected { updatedAt }" },
        { status: 400 },
      );
    }
    await markSeen(match.id, body.updatedAt);
    return Response.json({ ok: true });
  }

  return new Response("Not Found", { status: 404 });
}
