// POST /api/queue/checks — the per-check refinement for queue rows.
//
// The queue's own search deliberately carries no check nodes (queueQuery.ts:
// they cost 4-5s inside a search, most of GitHub's ~10s budget). Fetched
// through `repository.pullRequest` instead they are cheap, so this is a
// SECOND, deferred request: the table paints from the rollup and the rows
// sharpen a couple of seconds later.
//
// Same shape as the queue itself — parallel chunks, per-chunk failure, a hard
// cap on fan-out. It is read-only and invokes no model.
import { buildChecksQuery, chunkChecksRefs } from "../../shared/gh/checksQuery";
import type { ChecksRef } from "../../shared/gh/checksQuery";
import { checkRunOf, rollupOf } from "../../shared/gh/normalize";
import { isPlainObject } from "../../shared/is-plain-object";
import type { GqlCommitWithChecks } from "../../shared/gh/wire";
import type {
  ChecksResult,
  ChecksSnapshot,
  PrId,
} from "../../shared/review-types";
import { loadConfig } from "../config/store";
import type { Config } from "../config/store";
import { parseJsonBody } from "../requestJson";
import { graphql } from "./client";

/** The alias wraps a `repository`, which wraps the `pullRequest` — both are
 * nullable (a repo or PR that moved), and both nulls mean the same thing here:
 * that row keeps the rollup it already had. */
type GqlRepoChecks = {
  pullRequest: { commits: { nodes: GqlCommitWithChecks[] } } | null;
} | null;

export async function handleQueueChecks(req: Request): Promise<Response> {
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });
  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });

  const refs = readRefs(await parseJsonBody(req));
  if (!refs)
    return Response.json(
      { error: "expected { prs: [{ prId, owner, repo, number }] }" },
      { status: 400 },
    );

  return Response.json(await fetchChecks(cfg, refs, req.signal));
}

export async function fetchChecks(
  cfg: Config,
  refs: readonly ChecksRef[],
  signal?: AbortSignal,
): Promise<ChecksResult> {
  const chunks = chunkChecksRefs(refs);
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { gql, aliasToPrId } = buildChecksQuery(chunk);
      try {
        const { data } = await graphql<Record<string, GqlRepoChecks>>(
          cfg.github,
          gql,
          {},
          signal,
        );
        return unpack(data, aliasToPrId);
      } catch (err) {
        // A failed chunk costs those rows their refinement and nothing else —
        // they keep showing the rollup, which is what they showed before this
        // request existed.
        console.error("queue-checks chunk failed", err);
        return {} as Record<PrId, ChecksSnapshot>;
      }
    }),
  );
  return { checks: Object.assign({}, ...results) as ChecksResult["checks"] };
}

function unpack(
  data: Record<string, GqlRepoChecks>,
  aliasToPrId: Record<string, PrId>,
): Record<PrId, ChecksSnapshot> {
  const checks: Record<PrId, ChecksSnapshot> = {};
  for (const [alias, prId] of Object.entries(aliasToPrId)) {
    const commit = data[alias]?.pullRequest?.commits.nodes[0]?.commit;
    if (!commit) continue;
    const rollup = commit.statusCheckRollup;
    const nodes = rollup?.contexts.nodes ?? [];
    checks[prId] = {
      headSha: commit.oid,
      checkRollup: rollupOf(rollup?.state),
      checkRuns: nodes.map(checkRunOf),
      checkTotal: rollup?.contexts.totalCount ?? nodes.length,
    };
  }
  return checks;
}

function readRefs(body: unknown): ChecksRef[] | null {
  if (!isPlainObject(body) || !Array.isArray(body.prs)) return null;
  const refs: ChecksRef[] = [];
  for (const raw of body.prs) {
    if (!isPlainObject(raw)) return null;
    const { prId, owner, repo, number } = raw;
    if (
      typeof prId !== "string" ||
      typeof owner !== "string" ||
      typeof repo !== "string" ||
      typeof number !== "number"
    )
      return null;
    refs.push({ prId: prId as PrId, owner, repo, number });
  }
  return refs;
}
