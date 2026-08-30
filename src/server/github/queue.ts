// POST /api/queue — one GraphQL search per saved view, run in parallel.
//
// Deliberate divergence from the spec's "batch views with aliases in one
// request": a batched query's execution time is the SUM of its searches, and
// GitHub kills GraphQL requests around the 10s mark (502) — an org-wide view
// alone runs ~9s, so any batch containing it dies. Parallel single-view
// requests cost the same rate-limit points, isolate slow/failing views, and
// stay under the execution budget.
//
// A TEAM-backed view extends that same shape one level down: its `{team}`
// token is expanded and then CHUNKED (shared/gh/team.ts), and each chunk is
// its own parallel search. That is how a 25-person team gets full coverage
// without touching `first: 50`, which is measured and must not move.
import { normalizePr } from "../../shared/gh/normalize";
import { buildQueueQuery } from "../../shared/gh/queueQuery";
import { shardTeamQuery } from "../../shared/gh/team";
import { byUpdatedDesc, dedupePrs } from "../../shared/pulse";
import type { GqlRateLimit, GqlSearchResult } from "../../shared/gh/wire";
import type {
  PullRequest,
  QueueResult,
  RateLimitInfo,
} from "../../shared/review-types";
import type { Team } from "../../shared/team-types";
import { isPlainObject } from "../../shared/is-plain-object";
import { prewarmSweep } from "../agent/prewarm";
import { loadConfig } from "../config/store";
import type { Config } from "../config/store";
import { recordQueuePulse } from "../pulse/journal";
import { parseJsonBody } from "../requestJson";
import { teamMap } from "../teams/store";
import { graphql, GitHubError } from "./client";
import { handleQueueChecks } from "./checks";
import { API_PATHS } from "../../shared/api-paths";

const MAX_VIEWS = 10;
/**
 * Ceiling on searches ONE poll may issue across every view. Sharding makes a
 * single view able to fan out on its own, so the cap has to be global or a
 * few team views could quietly turn a 60s poll into forty searches.
 */
const MAX_SEARCHES_PER_POLL = 24;

export type QueueViewInput = {
  id: string;
  query: string;
  agentEnabled?: boolean;
  teamId?: string;
};

export async function handleQueue(req: Request): Promise<Response> {
  // Same prefix, different question: `/api/queue/checks` is the deferred
  // per-check refinement the search itself cannot afford to carry.
  if (new URL(req.url).pathname.startsWith(API_PATHS.QUEUE_CHECKS))
    return handleQueueChecks(req);
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

  // The daily pulse rollup, after the response is built and never blocking it —
  // same rule as pre-warm. Five integers per view per day (shared/pulse-journal).
  void recordQueuePulse(result);

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

/** One shard's outcome, so a partial failure loses that chunk and not the view. */
type ShardOutcome = {
  prs: PullRequest[];
  issueCount: number;
  error?: string;
  rateLimit: RateLimitInfo | null;
};

async function runSearch(
  cfg: Config,
  viewId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ShardOutcome> {
  const { gql, aliasToViewId } = buildQueueQuery([{ id: viewId, query }]);
  const alias = Object.keys(aliasToViewId)[0];
  try {
    const { data } = await graphql<
      Record<string, GqlSearchResult | GqlRateLimit>
    >(cfg.github, gql, {}, signal);
    const result = data[alias] as GqlSearchResult | undefined;
    return {
      prs: (result?.nodes ?? [])
        .map(normalizePr)
        .filter((pr): pr is PullRequest => pr !== null),
      issueCount: result?.issueCount ?? 0,
      rateLimit: (data.rateLimit as GqlRateLimit | undefined) ?? null,
    };
  } catch (e) {
    return {
      prs: [],
      issueCount: 0,
      rateLimit: null,
      error:
        e instanceof GitHubError
          ? e.message
          : e instanceof Error
            ? e.message
            : "request failed",
    };
  }
}

export async function fetchQueueViews(
  cfg: Config,
  views: QueueViewInput[],
  signal?: AbortSignal,
  teams?: Map<string, Team>,
): Promise<QueueResult> {
  const byView: Record<string, PullRequest[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const shards: Record<string, number> = {};
  let rateLimit: RateLimitInfo | null = null;

  // Only pay for teams.json when a view actually references a team — the vast
  // majority of polls have no teamId anywhere and this sits on the blocking
  // path of the hottest server route.
  const index =
    teams ??
    (views.some((v) => v.teamId) ? await teamMap() : new Map<string, Team>());
  // Plan every view's shards first, then apply the global budget in view
  // order: a cheap view must never be starved by an expensive one ahead of it
  // silently eating the whole allowance mid-flight.
  let budget = MAX_SEARCHES_PER_POLL;
  const planned: Array<{ view: QueueViewInput; queries: string[] }> = [];
  for (const view of views) {
    const team = view.teamId ? (index.get(view.teamId) ?? null) : null;
    const sharded = shardTeamQuery(view.query, team);
    if (!sharded.ok) {
      errors[view.id] = sharded.error;
      shards[view.id] = 0;
      byView[view.id] = [];
      counts[view.id] = 0;
      continue;
    }
    const queries = sharded.queries.slice(0, Math.max(0, budget));
    budget -= queries.length;
    if (queries.length < sharded.queries.length)
      errors[view.id] =
        `search budget reached — ran ${queries.length} of ${sharded.queries.length} team shards`;
    shards[view.id] = queries.length;
    planned.push({ view, queries });
  }

  await Promise.all(
    planned.map(async ({ view, queries }) => {
      const outcomes = await Promise.all(
        queries.map((query) => runSearch(cfg, view.id, query, signal)),
      );

      // A shard that failed is a hole in the coverage, not a failed view — say
      // so, and keep the rows the other shards found.
      const failures = outcomes.filter((o) => o.error);
      if (failures.length === outcomes.length && outcomes.length > 0) {
        errors[view.id] = failures[0].error as string;
      } else if (failures.length > 0) {
        errors[view.id] =
          `${failures.length} of ${outcomes.length} team shards failed: ${failures[0].error}`;
      }

      // Shards can overlap (a PR authored by one member and requested from
      // another), so dedupe on prId before anything reads a count.
      //
      // ORDER IS GITHUB'S, and deliberately so: a view's query owns its own
      // `sort:` qualifier, and the page window GitHub returns is chosen in
      // that same order — re-sorting here would show the first 50 of one
      // ordering arranged by another, which is how a long-open PR touched a
      // minute ago went missing from the queue entirely. The one case with no
      // order to honour is a sharded team view: N searches concatenated is
      // just N sorted runs end to end, so that merge picks newest-first.
      const rows = dedupePrs(outcomes.flatMap((o) => o.prs));
      byView[view.id] = queries.length > 1 ? rows.sort(byUpdatedDesc) : rows;
      // issueCounts sum across shards for the same reason the rows dedupe:
      // each shard searched a disjoint set of authors. Where a query can match
      // the same PR twice this over-counts slightly — it is GitHub's estimate
      // of "how much is out there", and the drawer only ever compares it
      // against the rows it actually holds.
      counts[view.id] = outcomes.reduce((sum, o) => sum + o.issueCount, 0);
      for (const outcome of outcomes) {
        const rl = outcome.rateLimit;
        // Report the tightest budget seen across the parallel calls.
        if (rl && (!rateLimit || rl.remaining < rateLimit.remaining))
          rateLimit = rl;
      }
    }),
  );

  return {
    views: byView,
    counts,
    errors,
    shards,
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
      teamId: typeof raw.teamId === "string" ? raw.teamId : undefined,
    });
  }
  return views;
}
