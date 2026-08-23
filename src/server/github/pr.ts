// GET /api/prs/:owner/:repo/:number — header, body, threads, checks.
import { PR_DETAIL_QUERY } from "../../shared/gh/detailQuery";
import { normalizePr, normalizeThread } from "../../shared/gh/normalize";
import type { GqlPrNode, GqlReviewThread } from "../../shared/gh/wire";
import type { PrRef } from "../../shared/gh/prKey";
import type { PrDetail } from "../../shared/review-types";
import type { Config } from "../config/store";
import { graphql } from "./client";

type DetailResponse = {
  repository: {
    pullRequest:
      | (GqlPrNode & {
          reviewThreads: { totalCount: number; nodes: GqlReviewThread[] };
        })
      | null;
  } | null;
};

export async function fetchPrDetail(
  cfg: Config,
  ref: PrRef,
  signal?: AbortSignal,
): Promise<PrDetail | null> {
  const { data } = await graphql<DetailResponse>(
    cfg.github,
    PR_DETAIL_QUERY,
    { owner: ref.owner, name: ref.repo, number: ref.number },
    signal,
  );
  const node = data.repository?.pullRequest;
  if (!node) return null;
  const pr = normalizePr(node);
  if (!pr) return null;
  return {
    pr,
    threads: node.reviewThreads.nodes.map(normalizeThread),
  };
}
