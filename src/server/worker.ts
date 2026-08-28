import { handleAgent, handleRuns } from "./agent/routes";
import { reconcileInterruptedRuns } from "./agent/runsIndex";
import { handleChats } from "./agent/chat/routes";
import { handleConfig } from "./config/routes";
import { handleQueue } from "./github/queue";
import { handlePrs } from "./github/routes";
import { handlePulse } from "./pulse/routes";
import { handleReviews } from "./reviews/routes";
import { handleTeams } from "./teams/routes";
import { handleSeen } from "./seen/routes";
import { handleSettings } from "./settings/routes";
import { handleViews } from "./views/routes";
import { serveAsset } from "./assets";
import { log } from "./log";
import { API_PATHS } from "../shared/api-paths";

const HOST = "127.0.0.1";
const FIRST_PORT = Number(Bun.env.TANDEM_SERVER_PORT ?? Bun.env.PORT ?? 5274);
const PORT_RANGE = 8;

function listen(port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: HOST,
    // Bun's default is 10s of socket idle, which races our SSE heartbeat
    // (also on the order of seconds) and the multi-minute agent runs.
    // Disable it — every connection is local, no public exposure.
    idleTimeout: 0,
    async fetch(req) {
      const start = Date.now();
      const url = new URL(req.url);
      try {
        let res: Response;
        if (url.pathname.startsWith(API_PATHS.CONFIG)) {
          res = await handleConfig(req);
        } else if (url.pathname.startsWith(API_PATHS.QUEUE)) {
          res = await handleQueue(req);
        } else if (url.pathname.startsWith(API_PATHS.PRS)) {
          res = await handlePrs(req);
        } else if (url.pathname.startsWith(API_PATHS.REVIEWS)) {
          res = await handleReviews(req);
        } else if (url.pathname.startsWith(API_PATHS.VIEWS)) {
          res = await handleViews(req);
        } else if (url.pathname.startsWith(API_PATHS.TEAMS)) {
          res = await handleTeams(req);
        } else if (url.pathname.startsWith(API_PATHS.PULSE)) {
          res = await handlePulse(req);
        } else if (url.pathname.startsWith(API_PATHS.RUNS)) {
          res = await handleRuns(req);
        } else if (url.pathname.startsWith(API_PATHS.CHATS)) {
          res = await handleChats(req);
        } else if (url.pathname.startsWith(API_PATHS.AGENT)) {
          res = await handleAgent(req);
        } else if (url.pathname.startsWith(API_PATHS.SEEN)) {
          res = await handleSeen(req);
        } else if (url.pathname.startsWith(API_PATHS.SETTINGS)) {
          res = await handleSettings(req);
        } else if (url.pathname.startsWith(`${API_PATHS.API}/`)) {
          res = Response.json({ error: "not found" }, { status: 404 });
        } else {
          res = await serveAsset(url.pathname);
        }
        log(req, res.status, Date.now() - start);
        return res;
      } catch (e) {
        // Client cancelled (e.g. a superseded poll). The connection is already
        // gone — log it as 499 without an error stack.
        if (req.signal.aborted) {
          log(req, 499, Date.now() - start);
          return new Response(null, { status: 499 });
        }
        log(req, 500, Date.now() - start, e);
        return new Response("Internal error", { status: 500 });
      }
    },
  });
}

function isAddressInUse(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string };
  if (err.code === "EADDRINUSE") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("eaddrinuse") || msg.includes("in use");
}

function tryListen(): ReturnType<typeof Bun.serve> {
  for (let i = 0; i < PORT_RANGE; i++) {
    const port = FIRST_PORT + i;
    try {
      return listen(port);
    } catch (e) {
      if (isAddressInUse(e)) {
        console.error(`[server] port ${port} in use, trying ${port + 1}`);
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    `could not bind any port in ${FIRST_PORT}..${FIRST_PORT + PORT_RANGE - 1}`,
  );
}

const server = tryListen();
console.log(`tandem server → http://${HOST}:${server.port}`);

// Runs are owned by a PROCESS: anything still marked active long after the
// process that started it vanished is interrupted, not running.
void reconcileInterruptedRuns()
  .then((swept) => {
    if (swept > 0) console.error(`[runs] ${swept} interrupted run(s) → failed`);
  })
  .catch((e) => console.error("[runs] interrupted-run sweep failed:", e));

// When loaded as a Worker by src/server/app.ts, postMessage is defined and the
// main thread is waiting for the bound port before opening the webview. When
// loaded directly (`bun src/server/worker.ts` — server-only, no native window),
// postMessage is undefined and we just print the URL.
declare const postMessage: ((msg: unknown) => void) | undefined;
if (typeof postMessage === "function") {
  postMessage({ type: "ready", host: HOST, port: server.port });
}
