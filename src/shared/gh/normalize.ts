// GitHub wire shapes → app types. Pure and runtime-neutral: imported by the
// Bun server (queue/pr routes, agent pipeline context) and testable without I/O.
import type { CheckRollup, CheckRun, FileChange, PullRequest, ReviewThread } from '../review-types';
import { isGeneratedPath } from './generated';
import { prIdOf } from './prKey';
import type { GqlCheckContext, GqlPrNode, GqlReviewThread, RestPullFile } from './wire';

export function rollupOf(state: string | null | undefined): CheckRollup {
  switch (state) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'ERROR':
      return 'FAILURE';
    case 'PENDING':
    case 'EXPECTED':
      return 'PENDING';
    default:
      return 'NONE';
  }
}

export function checkRunOf(ctx: GqlCheckContext): CheckRun {
  if (ctx.__typename === 'CheckRun') {
    return { name: ctx.name, status: checkRunStatus(ctx.status, ctx.conclusion), url: ctx.detailsUrl ?? undefined };
  }
  return { name: ctx.context, status: statusContextStatus(ctx.state), url: ctx.targetUrl ?? undefined };
}

function checkRunStatus(status: string, conclusion: string | null): CheckRun['status'] {
  if (status !== 'COMPLETED') return 'pending';
  switch (conclusion) {
    case 'SUCCESS':
      return 'success';
    case 'NEUTRAL':
      return 'neutral';
    case 'SKIPPED':
      return 'skipped';
    // FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STALE, STARTUP_FAILURE —
    // anything that isn't a pass reads as failing in a review queue.
    default:
      return 'failure';
  }
}

function statusContextStatus(state: string): CheckRun['status'] {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'failure';
  }
}

/** A queue-search or detail PR node → PullRequest. Null for non-PR search hits. */
export function normalizePr(node: GqlPrNode | null): PullRequest | null {
  if (!node || (node.__typename && node.__typename !== 'PullRequest')) return null;
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
    bodyMarkdown: node.body ?? '',
    author: node.author?.login ?? 'ghost',
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    headSha: head?.oid ?? '',
    isDraft: node.isDraft,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    reviewDecision: node.reviewDecision,
    checkRollup: rollupOf(rollup?.state),
    checkRuns: (rollup?.contexts.nodes ?? []).map(checkRunOf),
    threadCount: node.reviewThreads.totalCount,
    // Accurate only when the caller fetched thread nodes (the detail query);
    // the queue search fetches totalCount alone and renders just that.
    unresolvedThreadCount: threads ? threads.filter((t) => !t.isResolved).length : 0,
    updatedAt: node.updatedAt,
    url: node.url,
  };
}

export function normalizeThread(t: GqlReviewThread): ReviewThread {
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
      author: c.author?.login ?? 'ghost',
      bodyMarkdown: c.body,
      createdAt: c.createdAt,
    })),
  };
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
    isBinary: f.patch === undefined && f.additions === 0 && f.deletions === 0 && f.changes === 0,
    isGenerated: isGeneratedPath(f.filename),
  };
}
