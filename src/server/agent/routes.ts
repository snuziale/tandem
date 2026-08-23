// /api/runs — agent run records, live SSE streams, cancel, rerun, finding
// state transitions. /api/agent/health — claude CLI availability.
import { API_PATHS } from "../../shared/api-paths";
import type { FindingState, RunEvent } from "../../shared/agent-types";
import { isPlainObject } from "../../shared/isPlainObject";
import { loadConfig } from "../config/store";
import { matchIdPath } from "../pathMatch";
import { parseJsonBody } from "../requestJson";
import { checkClaudeAvailable } from "./claude";
import { cancelLive, isLive, liveCount, replay, subscribe } from "./live";
import { startRun } from "./pipeline/run";
import {
  getRunById,
  listRuns,
  spendToday,
  transitionFinding,
} from "./runsIndex";

export async function handleAgent(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === API_PATHS.AGENT_HEALTH && req.method === "GET") {
    return Response.json(await checkClaudeAvailable());
  }
  return new Response("Not Found", { status: 404 });
}

export async function handleRuns(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === API_PATHS.RUNS && req.method === "GET") {
    return Response.json({
      runs: await listRuns(),
      spendTodayUsd: await spendToday(),
      liveCount: liveCount(),
    });
  }

  if (url.pathname === `${API_PATHS.RUNS}/start` && req.method === "POST") {
    return handleStart(req);
  }

  const match = matchIdPath(url.pathname, API_PATHS.RUNS);
  if (!match) return new Response("Not Found", { status: 404 });
  const runId = match.id;

  if (match.rest === "/stream" && req.method === "GET") {
    return streamRun(runId);
  }

  if (match.rest === "/cancel" && req.method === "POST") {
    return Response.json({ ok: cancelLive(runId) });
  }

  const findingMatch = /^\/findings\/([^/]+)$/.exec(match.rest);
  if (findingMatch && req.method === "POST") {
    return handleFindingState(req, runId, decodeURIComponent(findingMatch[1]));
  }

  return new Response("Not Found", { status: 404 });
}

async function handleStart(req: Request): Promise<Response> {
  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });
  const body = await parseJsonBody(req);
  if (!isPlainObject(body) || typeof body.prId !== "string") {
    return Response.json(
      { error: "expected { prId, force?, agentId? }" },
      { status: 400 },
    );
  }
  try {
    const result = await startRun(cfg, body.prId, {
      force: body.force === true,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "start failed" },
      { status: 500 },
    );
  }
}

const FINDING_STATES: FindingState[] = [
  "proposed",
  "staged",
  "edited",
  "dismissed",
  "posted",
  "stale",
];

async function handleFindingState(
  req: Request,
  runId: string,
  findingId: string,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const state = isPlainObject(body) ? body.state : undefined;
  if (
    typeof state !== "string" ||
    !FINDING_STATES.includes(state as FindingState)
  ) {
    return Response.json(
      { error: "expected { state: FindingState }" },
      { status: 400 },
    );
  }
  try {
    const run = await transitionFinding(
      runId,
      findingId,
      state as FindingState,
    );
    return Response.json({ run });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "transition failed" },
      { status: 409 },
    );
  }
}

// SSE: replay the live buffer then tail (Sift's replay-then-tail in one
// synchronous block, so no event slips between). A finished run answers with
// its final state immediately.
async function streamRun(runId: string): Promise<Response> {
  if (!isLive(runId)) {
    const run = await getRunById(runId);
    if (!run) return new Response("Not Found", { status: 404 });
    const finalEvent: RunEvent = { type: "done", run };
    return new Response(`data: ${JSON.stringify(finalEvent)}\n\n`, {
      headers: sseHeaders(),
    });
  }

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat !== null) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by cancel()
        }
      };
      heartbeat = setInterval(
        () => write(`: heartbeat ${Date.now()}\n\n`),
        5_000,
      );

      for (const serialized of replay(runId)) write(`data: ${serialized}\n\n`);
      unsubscribe = subscribe(runId, (event, serialized) => {
        write(`data: ${serialized}\n\n`);
        if (event.type === "done") close();
      });
      if (!unsubscribe) close(); // finished between the isLive check and here
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat !== null) clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
}
