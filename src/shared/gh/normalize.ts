// GitHub wire shapes → app types. Pure and runtime-neutral: imported by the
// Bun server (queue/pr routes, agent pipeline context) and testable without I/O.
import type {
  CheckRollup,
  CheckRun,
  FileChange,
  PullRequest,
  ReviewThread,
} from "../review-types";
import {
  attachmentProxyBase,
  attachmentSourcesFromHtml,
  rewriteAttachmentUrls,
} from "./attachments";
import { isGeneratedPath } from "./generated";
import { prIdOf, type PrRef } from "./prKey";
import type {
  GqlCheckContext,
  GqlPrNode,
  GqlReviewRequest,
  GqlReviewThread,
  RestPullFile,
} from "./wire";

export function rollupOf(state: string | null | undefined): CheckRollup {
  switch (state) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILURE":
    case "ERROR":
      return "FAILURE";
    case "PENDING":
    case "EXPECTED":
      return "PENDING";
    default:
      return "NONE";
  }
}

export function checkRunOf(ctx: GqlCheckContext): CheckRun {
  if (ctx.__typename === "CheckRun") {
    return {
      name: ctx.name,
      status: checkRunStatus(ctx.status, ctx.conclusion),
      url: ctx.detailsUrl ?? undefined,
      // `completedAt` first, then `startedAt`: a run still going has no
      // completion, and it is newer than the finished one it replaces.
      at: ctx.completedAt ?? ctx.startedAt ?? null,
    };
  }
  return {
    name: ctx.context,
    status: statusContextStatus(ctx.state),
    url: ctx.targetUrl ?? undefined,
    at: ctx.createdAt ?? null,
  };
}

function checkRunStatus(
  status: string,
  conclusion: string | null,
): CheckRun["status"] {
  if (status !== "COMPLETED") return "pending";
  switch (conclusion) {
    case "SUCCESS":
      return "success";
    case "NEUTRAL":
      return "neutral";
    case "SKIPPED":
      return "skipped";
    // Cancelled is not failed. A cancelled run is usually one superseded by a
    // re-run seconds later, and calling it "failing" put a red count on a PR
    // whose checks GitHub lists as cancelled — a different claim.
    case "CANCELLED":
      return "cancelled";
    // FAILURE, TIMED_OUT, ACTION_REQUIRED, STALE, STARTUP_FAILURE — anything
    // else that isn't a pass reads as failing in a review queue.
    default:
      return "failure";
  }
}

function statusContextStatus(state: string): CheckRun["status"] {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "failure";
  }
}

/**
 * Outstanding review requests as flat strings: a user is its login, a team is
 * `org/slug` so it can never be mistaken for one. Team membership is not
 * resolvable from a search response, which is why awaitsViewer() in
 * shared/pulse.ts only ever matches a direct user request.
 */
export function reviewRequestOf(request: GqlReviewRequest): string | null {
  const reviewer = request.requestedReviewer;
  if (!reviewer) return null;
  if (reviewer.__typename === "User") return reviewer.login;
  const org = reviewer.organization?.login;
  return org ? `${org}/${reviewer.slug}` : reviewer.slug;
}

/** A queue-search or detail PR node → PullRequest. Null for non-PR search hits. */
export function normalizePr(node: GqlPrNode | null): PullRequest | null {
  if (!node || (node.__typename && node.__typename !== "PullRequest"))
    return null;
  const owner = node.repository.owner.login;
  const repo = node.repository.name;
  const head = node.commits.nodes[0]?.commit;
  const rollup = head?.statusCheckRollup ?? null;
  const threads = node.reviewThreads.nodes;
  return {
    prId: prIdOf(owner, repo, node.number),
    owner,
    repo,
    number: node.number,
    title: node.title,
    // Attachment URLs are rewritten HERE so every reader downstream — the
    // description, a thread card, the agent's prompt context — sees the one
    // form that loads. See shared/gh/attachments.ts.
    bodyMarkdown: withAttachments(node.body ?? "", node.bodyHTML, {
      owner,
      repo,
      number: node.number,
    }),
    author: node.author?.login ?? "ghost",
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    headSha: head?.oid ?? "",
    isDraft: node.isDraft,
    state: node.state ?? "OPEN",
    commitCount: node.commits.totalCount ?? node.commits.nodes.length,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    reviewDecision: node.reviewDecision,
    viewerReviewState: node.viewerLatestReview?.state ?? null,
    checkRollup: rollupOf(rollup?.state),
    // Empty on a QUEUE response: the search asks for the rollup and the total
    // only, because the nodes cost half the queue's latency and 20 of 53 of
    // them cannot be counted honestly anyway (queueQuery.ts).
    checkRuns: (rollup?.contexts.nodes ?? []).map(checkRunOf),
    // What GitHub HAS, which is the number the column can state. `??` covers a
    // response from before this was queried: falling back to the nodes' own
    // length reports "not truncated", which adds no false precision.
    checkTotal:
      rollup?.contexts.totalCount ?? (rollup?.contexts.nodes ?? []).length,
    threadCount: node.reviewThreads.totalCount,
    // Pulse inputs. Absent on any response fetched before these fields were
    // added (or by a caller that doesn't need them) — zero is the honest
    // reading, and pulse.ts degrades to "moving" rather than inventing a state.
    approvalCount: node.approvals?.totalCount ?? 0,
    changesRequestedCount: node.changesRequested?.totalCount ?? 0,
    commentCount: node.comments?.totalCount ?? 0,
    autoMergeBy: node.autoMergeRequest?.enabledBy?.login ?? null,
    requestedReviewers: (node.reviewRequests?.nodes ?? [])
      .map(reviewRequestOf)
      .filter((r): r is string => r !== null),
    // Accurate only when the caller fetched thread nodes (the detail query);
    // the queue search fetches totalCount alone and renders just that.
    unresolvedThreadCount: threads
      ? threads.filter((t) => !t.isResolved).length
      : 0,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    url: node.url,
  };
}

export function normalizeThread(t: GqlReviewThread, ref: PrRef): ReviewThread {
  return {
    id: t.id,
    path: t.path,
    line: t.line,
    startLine: t.startLine ?? undefined,
    side: t.diffSide,
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    comments: t.comments.nodes.map((c) => ({
      id: c.id,
      author: c.author?.login ?? "ghost",
      bodyMarkdown: withAttachments(c.body, c.bodyHTML, ref),
      createdAt: c.createdAt,
    })),
  };
}

/** Point a body's attachments at the proxy; a no-op without GitHub's own
 * rendering to resolve them against. */
function withAttachments(
  markdown: string,
  html: string | undefined,
  ref: PrRef,
): string {
  if (!html) return markdown;
  return rewriteAttachmentUrls(
    markdown,
    attachmentSourcesFromHtml(html),
    attachmentProxyBase(ref.owner, ref.repo, ref.number),
  );
}

export function normalizeFile(f: RestPullFile): FileChange {
  return {
    path: f.filename,
    previousPath: f.previous_filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
    // The REST files API omits `patch` for binaries — with zero line changes
    // that's the only signal it gives.
    isBinary:
      f.patch === undefined &&
      f.additions === 0 &&
      f.deletions === 0 &&
      f.changes === 0,
    isGenerated: isGeneratedPath(f.filename),
  };
}
