// /api/runs — agent run records, live SSE streams, cancel, rerun, finding
// state transitions. /api/agent/health — claude CLI availability.
import { API_PATHS } from "../../shared/api-paths";
import type { FindingState, RunEvent } from "../../shared/agent-types";
import { isPlainObject } from "../../shared/isPlainObject";
import { loadConfig } from "../config/store";
import { matchIdPath } from "../pathMatch";
import { parseJsonBody } from "../requestJson";
import { checkClaudeAvailable } from "./claude";
import { cancelLive, liveCount } from "./live";
import { streamLive } from "./sse";
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

// SSE: replay-then-tail lives in sse.ts (chat turns stream the same way). A
// finished run answers with its final state immediately.
function streamRun(runId: string): Promise<Response> {
  return streamLive(
    runId,
    (event) => event.type === "done",
    async () => {
      const run = await getRunById(runId);
      return run ? ({ type: "done", run } satisfies RunEvent) : null;
    },
  );
}
