// /api/chats — the reviewer's conversations with the agent.
//
//   POST   /api/chats/turn                       ask something (starts a turn)
//   GET    /api/chats?prId=…                     every thread on a PR
//   GET    /api/chats/:id                        one session (id = chatKeyOf)
//   GET    /api/chats/:id/stream                 SSE: deltas, then turn-end
//   POST   /api/chats/:id/cancel                 the only kill switch
//   POST   /api/chats/:id/actions/:actionId      { state: applied | rejected }
//   DELETE /api/chats/:id                        forget the thread
//
// Applying an action is the ONLY state-changing thing a conversation can do,
// and it happens here — on an explicit human request, never from the turn.
import { API_PATHS } from "../../../shared/api-paths";
import type {
  ChatAnchor,
  ChatEvent,
  ChatScope,
} from "../../../shared/chat-types";
import { isPlainObject } from "../../../shared/is-plain-object";
import { loadConfig } from "../../config/store";
import { matchIdPath } from "../../pathMatch";
import { parseJsonBody } from "../../requestJson";
import { cancelLive } from "../live";
import { streamLive } from "../sse";
import { applyChatAction, markActionError, rejectChatAction } from "./actions";
import {
  clearStuckStatus,
  deleteSession,
  getSession,
  listSessionsForPr,
} from "./store";
import { startChatTurn } from "./turn";

export async function handleChats(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === API_PATHS.CHATS && req.method === "GET") {
    const prId = url.searchParams.get("prId");
    if (!prId)
      return Response.json({ error: "expected ?prId=" }, { status: 400 });
    return Response.json({ sessions: await listSessionsForPr(prId) });
  }

  if (url.pathname === `${API_PATHS.CHATS}/turn` && req.method === "POST") {
    return handleTurn(req);
  }

  const match = matchIdPath(url.pathname, API_PATHS.CHATS);
  if (!match) return new Response("Not Found", { status: 404 });
  const id = match.id;

  if (match.rest === "" && req.method === "GET") {
    // A session left `thinking` by a crashed process would make the client
    // open a stream nobody is driving.
    await clearStuckStatus(id);
    return Response.json({ session: await getSession(id) });
  }

  if (match.rest === "" && req.method === "DELETE") {
    await deleteSession(id);
    return Response.json({ ok: true });
  }

  if (match.rest === "/stream" && req.method === "GET") {
    return streamLive(
      id,
      (event) => event.type === "turn-end",
      async () => {
        const session = await getSession(id);
        return session
          ? ({ type: "turn-end", session } satisfies ChatEvent)
          : null;
      },
    );
  }

  if (match.rest === "/cancel" && req.method === "POST") {
    return Response.json({ ok: cancelLive(id) });
  }

  const action = /^\/actions\/([^/]+)$/.exec(match.rest);
  if (action && req.method === "POST") {
    return handleAction(req, id, decodeURIComponent(action[1]));
  }

  return new Response("Not Found", { status: 404 });
}

/**
 * The reviewer's line selection, off the wire. Untrusted like anything else
 * from a client: a malformed anchor degrades to "no anchor" — the turn still
 * answers about the PR — rather than 400ing a question someone typed.
 */
function parseAnchor(raw: unknown): ChatAnchor | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { path, side, line, startLine } = raw;
  if (typeof path !== "string" || !path) return undefined;
  if (side !== "LEFT" && side !== "RIGHT") return undefined;
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1)
    return undefined;
  const start =
    typeof startLine === "number" &&
    Number.isInteger(startLine) &&
    startLine >= 1 &&
    startLine < line
      ? startLine
      : undefined;
  return { path, side, line, startLine: start };
}

function parseContextPaths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const paths = raw.filter(
    (p): p is string => typeof p === "string" && p.length > 0 && p.length < 400,
  );
  return paths.length ? paths : undefined;
}

async function handleTurn(req: Request): Promise<Response> {
  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });
  const body = await parseJsonBody(req);
  if (
    !isPlainObject(body) ||
    typeof body.prId !== "string" ||
    typeof body.headSha !== "string" ||
    typeof body.message !== "string"
  ) {
    return Response.json(
      {
        error:
          "expected { prId, headSha, message, findingId?, agentId?, anchor?, contextPaths? }",
      },
      { status: 400 },
    );
  }
  const scope: ChatScope = {
    prId: body.prId,
    headSha: body.headSha,
    findingId: typeof body.findingId === "string" ? body.findingId : undefined,
  };
  try {
    const result = await startChatTurn(cfg, scope, {
      message: body.message,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      anchor: parseAnchor(body.anchor),
      contextPaths: parseContextPaths(body.contextPaths),
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "could not start the turn" },
      { status: 409 },
    );
  }
}

async function handleAction(
  req: Request,
  sessionId: string,
  actionId: string,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const state = isPlainObject(body) ? body.state : undefined;
  if (state !== "applied" && state !== "rejected") {
    return Response.json(
      { error: 'expected { state: "applied" | "rejected" }' },
      { status: 400 },
    );
  }
  try {
    if (state === "rejected") {
      return Response.json({
        session: await rejectChatAction(sessionId, actionId),
      });
    }
    return Response.json(await applyChatAction(sessionId, actionId));
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not apply";
    // Record it on the chip: a failed apply must not look like a no-op.
    await markActionError(sessionId, actionId, message);
    return Response.json({ error: message }, { status: 409 });
  }
}
