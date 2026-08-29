import { API_PATHS } from "../../shared/api-paths";
import { isPlainObject } from "../../shared/is-plain-object";
import { matchIdPath } from "../pathMatch";
import { parseJsonBody } from "../requestJson";
import { loadSeen, markSeen } from "./store";

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

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
        { error: "expected { updatedAt, headSha, commentCount, threadCount }" },
        { status: 400 },
      );
    }
    // Only updatedAt is required: the three that widened the record degrade to
    // the empty reading, which hasUnseenChanges already treats as "knows less".
    await markSeen(match.id, {
      updatedAt: body.updatedAt,
      headSha: typeof body.headSha === "string" ? body.headSha : "",
      commentCount: count(body.commentCount),
      threadCount: count(body.threadCount),
    });
    return Response.json({ ok: true });
  }

  return new Response("Not Found", { status: 404 });
}
