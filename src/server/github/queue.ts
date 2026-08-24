// POST /api/queue — one GraphQL search per saved view, run in parallel.
//
// Deliberate divergence from the spec's "batch views with aliases in one
// request": a batched query's execution time is the SUM of its searches, and
// GitHub kills GraphQL requests around the 10s mark (502) — an org-wide view
// alone runs ~9s, so any batch containing it dies. Parallel single-view
// requests cost the same rate-limit points, isolate slow/failing views, and
// stay under the execution budget.
import { normalizePr } from "../../shared/gh/normalize";
import { buildQueueQuery } from "../../shared/gh/queueQuery";
import type { GqlRateLimit, GqlSearchResult } from "../../shared/gh/wire";
import type {
  PullRequest,
  QueueResult,
  RateLimitInfo,
} from "../../shared/review-types";
import { isPlainObject } from "../../shared/is-plain-object";
import { prewarmSweep } from "../agent/prewarm";
import { loadConfig } from "../config/store";
import type { Config } from "../config/store";
import { parseJsonBody } from "../requestJson";
import { graphql, GitHubError } from "./client";

const MAX_VIEWS = 10;

type QueueViewInput = { id: string; query: string; agentEnabled?: boolean };

export async function handleQueue(req: Request): Promise<Response> {
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });
  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });

  const body = await parseJsonBody(req);
  const views = readViews(body);
  if (!views)
    return Response.json(
      { error: "expected { views: [{ id, query }] }" },
      { status: 400 },
    );

  const capped = views.slice(0, MAX_VIEWS);
  const result = await fetchQueueViews(cfg, capped, req.signal);

  // Pre-warm: hand every PR from an agent-enabled view to the agent AFTER the
  // response is built — the queue must never wait on the agent.
  const agentViewIds = new Set(
    capped.filter((v) => v.agentEnabled).map((v) => v.id),
  );
  const prewarmPrs = Object.entries(result.views)
    .filter(([viewId]) => agentViewIds.has(viewId))
    .flatMap(([, prs]) => prs);
  if (prewarmPrs.length > 0) prewarmSweep(cfg, prewarmPrs);

  return Response.json(result);
}

export async function fetchQueueViews(
  cfg: Config,
  views: Array<{ id: string; query: string }>,
  signal?: AbortSignal,
): Promise<QueueResult> {
  const byView: Record<string, PullRequest[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let rateLimit: RateLimitInfo | null = null;

  await Promise.all(
    views.map(async (view) => {
      const { gql, aliasToViewId } = buildQueueQuery([view]);
      const alias = Object.keys(aliasToViewId)[0];
      try {
        const { data } = await graphql<
          Record<string, GqlSearchResult | GqlRateLimit>
        >(cfg.github, gql, {}, signal);
        const result = data[alias] as GqlSearchResult | undefined;
        byView[view.id] = (result?.nodes ?? [])
          .map(normalizePr)
          .filter((pr): pr is PullRequest => pr !== null);
        counts[view.id] = result?.issueCount ?? 0;
        const rl = data.rateLimit as GqlRateLimit | undefined;
        // Report the tightest budget seen across the parallel calls.
        if (rl && (!rateLimit || rl.remaining < rateLimit.remaining))
          rateLimit = rl;
      } catch (e) {
        errors[view.id] =
          e instanceof GitHubError
            ? e.message
            : e instanceof Error
              ? e.message
              : "request failed";
      }
    }),
  );

  return {
    views: byView,
    counts,
    errors,
    rateLimit,
    fetchedAt: new Date().toISOString(),
  };
}

function readViews(body: unknown): QueueViewInput[] | null {
  if (!isPlainObject(body) || !Array.isArray(body.views)) return null;
  const views: QueueViewInput[] = [];
  for (const raw of body.views) {
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.query !== "string" ||
      !raw.query.trim()
    )
      return null;
    views.push({
      id: raw.id,
      query: raw.query,
      agentEnabled: raw.agentEnabled === true,
    });
  }
  return views;
}
