// Pre-warming (spec §1 principle 2): the agent starts analyzing a PR when it
// ENTERS the queue, not when you open it. handleQueue hands every fetched PR
// from an agent-enabled view here after responding; this module decides —
// cache hit, cheap skip, stale sweep, or enqueue — and drains the work queue
// at bounded concurrency. Staleness (spec §2): a moved headSha marks the old
// run + findings stale, flags draft comments whose anchors vanished, and
// auto-enqueues the new sha. Nothing is ever silently deleted.
import type { AgentRun, SkipReason } from '../../shared/agent-types';
import { diffLineIndex, type DiffLineIndex } from '../../shared/gh/patch';
import { parsePrId } from '../../shared/gh/prKey';
import type { PrId, PullRequest } from '../../shared/review-types';
import type { Config } from '../config/store';
import { fetchPrFiles } from '../github/files';
import { loadReview, saveReview } from '../reviews/store';
import { agentEnabledFor, loadSettings } from '../settings/store';
import { startRun } from './pipeline/run';
import { skipDecision } from './pipeline/decide';
import { liveCount } from './live';
import { getRun, listRuns, markRunStale, spendToday, upsertRun } from './runsIndex';

const MAX_CONCURRENT_PREWARM = 2;

const pending: PrId[] = [];
const queued = new Set<PrId>();
let draining = false;

/** Fire-and-forget from handleQueue. Never throws into the request path. */
export function prewarmSweep(cfg: Config, prs: PullRequest[]): void {
  void sweep(cfg, prs).catch((e) => console.error('[prewarm] sweep failed:', e));
}

async function sweep(cfg: Config, prs: PullRequest[]): Promise<void> {
  const settings = await loadSettings();
  const allRuns = await listRuns();
  const runsByPr = new Map<PrId, AgentRun[]>();
  for (const run of allRuns) {
    const list = runsByPr.get(run.prId) ?? [];
    list.push(run);
    runsByPr.set(run.prId, list);
  }

  const seen = new Set<PrId>();
  for (const pr of prs) {
    if (seen.has(pr.prId) || !pr.headSha) continue;
    seen.add(pr.prId);

    // Staleness: any non-stale run for this PR on a superseded sha.
    for (const run of runsByPr.get(pr.prId) ?? []) {
      if (run.headSha !== pr.headSha && run.status !== 'stale') {
        await markRunStale(pr.prId, run.headSha);
        await flagMovedAnchors(cfg, pr);
      }
    }

    const existing = await getRun(pr.prId, pr.headSha);
    // Cache rule: never auto re-run a sha. Failed runs also stay manual —
    // auto-retrying a deterministic failure would burn budget every poll.
    if (existing) continue;

    const ref = parsePrId(pr.prId);
    if (!ref) continue;
    const skip = skipDecision(
      {
        isDraft: pr.isDraft,
        changedFiles: pr.changedFiles,
        diffLines: pr.additions + pr.deletions,
        allGenerated: false, // unknowable without the file list; the pipeline re-checks
        agentEnabled: agentEnabledFor(settings, `${ref.owner}/${ref.repo}`),
        spentTodayUsd: await spendToday(),
      },
      settings
    );
    if (skip.skip) {
      await recordSkip(pr, skip.reason);
      continue;
    }

    if (!queued.has(pr.prId)) {
      queued.add(pr.prId);
      pending.push(pr.prId);
    }
  }

  void drain(cfg);
}

async function drain(cfg: Config): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.length > 0) {
      if (liveCount() >= MAX_CONCURRENT_PREWARM) {
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      const prId = pending.shift()!;
      queued.delete(prId);
      try {
        await startRun(cfg, prId);
      } catch (e) {
        console.error(`[prewarm] start failed for ${prId}:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    draining = false;
  }
}

async function recordSkip(pr: PullRequest, reason: SkipReason): Promise<void> {
  const now = new Date().toISOString();
  await upsertRun({
    id: crypto.randomUUID(),
    prId: pr.prId,
    headSha: pr.headSha,
    status: 'skipped',
    skipReason: reason,
    findings: [],
    tokensUsed: 0,
    costUsd: 0,
    startedAt: now,
    finishedAt: now,
  });
}

// New commits arrived: staged draft comments survive, but any whose anchor
// line no longer exists in the new diff is flagged anchorMoved (blocks
// submit until the human re-anchors or removes it). The draft's headSha
// advances so a clean submit anchors against the current commit.
async function flagMovedAnchors(cfg: Config, pr: PullRequest): Promise<void> {
  const draft = await loadReview(pr.prId);
  if (!draft || draft.headSha === pr.headSha) return;
  const ref = parsePrId(pr.prId);
  if (!ref) return;

  let indexByPath: Map<string, DiffLineIndex>;
  try {
    const files = await fetchPrFiles(cfg, ref);
    indexByPath = new Map(files.filter((f) => f.patch !== undefined).map((f) => [f.path, diffLineIndex(f.patch!)]));
  } catch (e) {
    console.error(`[prewarm] anchor check failed for ${pr.prId}:`, e instanceof Error ? e.message : e);
    return;
  }

  const comments = draft.comments.map((comment) => {
    const index = indexByPath.get(comment.path);
    const side = comment.side === 'LEFT' ? index?.left : index?.right;
    const anchored = !!side && side.has(comment.line);
    return { ...comment, anchorMoved: anchored ? undefined : true };
  });
  await saveReview({ ...draft, comments, headSha: pr.headSha });
}
