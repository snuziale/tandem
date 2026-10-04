// GET /api/prs/:o/:r/:n/stack — SPIKE. The PR's stack, found by walking the
// base/head branch chain (base of one == head of the one below), plus the
// combined diff of the whole stack from the compare API. Read-only.
import { normalizeFile } from "../../shared/gh/normalize";
import { prIdOf, type PrRef } from "../../shared/gh/prKey";
import type { PrStack, StackPr } from "../../shared/gh/stack";
import type { RestPullFile } from "../../shared/gh/wire";
import type { Config } from "../config/store";
import { graphql, rest } from "./client";

const MAX_DEPTH = 8;

export async function fetchPrStack(
  cfg: Config,
  ref: PrRef,
  signal?: AbortSignal,
): Promise<PrStack> {
  const self = await query(
    cfg,
    ref,
    `pullRequest(number: ${ref.number}) { ...P } defaultBranchRef { name }`,
    signal,
  );
  const start = self.repository?.pullRequest;
  if (!start) return { prs: [], combined: [], unrebased: [] };
  const trunk = self.repository?.defaultBranchRef?.name;

  const prs: StackPr[] = [toStackPr(ref, start)];
  // A cycle (A based on B, B based on A) would otherwise repeat until MAX_DEPTH.
  const seen = new Set([start.number]);
  // Down: an open PR whose HEAD is this one's base. Never through the default
  // branch: an open release PR (develop → main) is not a layer of every
  // feature PR based on develop.
  for (let i = 0; i < MAX_DEPTH && prs[0].baseRef !== trunk; i++) {
    const below = await firstOpen(
      cfg,
      ref,
      "headRefName",
      prs[0].baseRef,
      signal,
    );
    if (!below || seen.has(below.number) || below.headRefName === trunk) break;
    seen.add(below.number);
    prs.unshift(toStackPr(ref, below));
  }
  // Up: an open PR BASED on this one's head. A fork in the stack takes the first.
  for (let i = 0; i < MAX_DEPTH; i++) {
    const above = await firstOpen(
      cfg,
      ref,
      "baseRefName",
      prs[prs.length - 1].headRef,
      signal,
    );
    if (!above || seen.has(above.number)) break;
    seen.add(above.number);
    prs.push(toStackPr(ref, above));
  }
  if (prs.length < 2) return { prs, combined: [], unrebased: [] };

  // Three-dot compare = merge-base diff, the same thing a PR's own diff is.
  const bottom = prs[0];
  const top = prs[prs.length - 1];
  const { data } = await rest<{ files?: RestPullFile[] }>(
    cfg.github,
    `/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(bottom.baseRef)}...${top.headSha}`,
    { signal },
  );
  return {
    prs,
    combined: (data.files ?? []).map(normalizeFile),
    unrebased: await unrebasedLayers(cfg, ref, prs, signal),
  };
}

/**
 * PRs whose head does not contain the head of the PR below. Ownership walks
 * each layer's patch on top of the one below, which only composes when the
 * stack is rebased — otherwise a comment routes onto different content.
 */
async function unrebasedLayers(
  cfg: Config,
  ref: PrRef,
  prs: StackPr[],
  signal?: AbortSignal,
): Promise<number[]> {
  const checks = prs.slice(1).map(async (pr, i) => {
    const { data } = await rest<{ status?: string }>(
      cfg.github,
      `/repos/${ref.owner}/${ref.repo}/compare/${prs[i].headSha}...${pr.headSha}`,
      { signal },
    );
    return data.status === "ahead" || data.status === "identical"
      ? null
      : pr.number;
  });
  return (await Promise.all(checks)).filter((n) => n !== null);
}

type Node = {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
};

async function firstOpen(
  cfg: Config,
  ref: PrRef,
  field: "headRefName" | "baseRefName",
  branch: string,
  signal?: AbortSignal,
): Promise<Node | null> {
  const res = await query(
    cfg,
    ref,
    `pullRequests(${field}: ${JSON.stringify(branch)}, states: OPEN, first: 5) { nodes { ...P } }`,
    signal,
  );
  return (
    res.repository?.pullRequests?.nodes.find((n) => !n.isCrossRepository) ??
    null
  );
}

async function query(
  cfg: Config,
  ref: PrRef,
  selection: string,
  signal?: AbortSignal,
) {
  const { data } = await graphql<{
    repository: {
      pullRequest?: Node | null;
      pullRequests?: { nodes: Node[] };
      defaultBranchRef?: { name: string } | null;
    } | null;
  }>(
    cfg.github,
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${selection} } }
     fragment P on PullRequest { number title headRefName baseRefName headRefOid isCrossRepository }`,
    { owner: ref.owner, name: ref.repo },
    signal,
  );
  return data;
}

function toStackPr(ref: PrRef, n: Node): StackPr {
  return {
    prId: prIdOf(ref.owner, ref.repo, n.number),
    number: n.number,
    title: n.title,
    headRef: n.headRefName,
    baseRef: n.baseRefName,
    headSha: n.headRefOid,
  };
}
