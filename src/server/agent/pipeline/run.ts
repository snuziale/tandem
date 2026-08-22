// The three-pass pipeline orchestrator. One executeRun per (prId, headSha):
// orient → analyze (per cluster) → reconcile, all through the read-only
// claude CLI harness, findings validated and post-filtered before anything is
// stored. Runs are detached from HTTP (live.ts); results land in runsIndex.
import { randomUUID } from 'node:crypto';
import type { AgentRun, Finding, RunEvent } from '../../../shared/agent-types';
import { Pass1PlanSchema, Pass2OutputSchema, Pass3OutputSchema, type FindingJson, type Pass1Plan } from '../../../shared/finding-schema';
import { countDiffLines, diffLineIndex, type DiffLineIndex } from '../../../shared/gh/patch';
import { parsePrId, type PrRef } from '../../../shared/gh/prKey';
import type { FileChange, PrDetail, PrId } from '../../../shared/review-types';
import type { TandemSettings } from '../../../shared/settings-types';
import type { Config } from '../../config/store';
import { fetchPrFiles } from '../../github/files';
import { fetchPrDetail } from '../../github/pr';
import { agentEnabledFor, loadSettings } from '../../settings/store';
import { runClaudePass, type ClaudePassResult } from '../claude';
import { createLive, finishLive, publish } from '../live';
import { addSpend, getRun, markRunStale, spendToday, upsertRun } from '../runsIndex';
import { analyzableFiles, clusterFiles } from './cluster';
import { fetchConventions, fetchRecentCommitSubjects } from './context';
import { skipDecision } from './decide';
import { parseWithSchema, sanitizeFindings, capFindings, type ParseResult } from './parse';
import { buildAnalyzePrompt, buildOrientPrompt, buildReconcilePrompt, buildRepairPrompt } from './prompts';
import type { ZodType } from 'zod';

export type StartResult = { run: AgentRun; started: boolean };

/**
 * Idempotent entry point: an existing non-stale run for the PR's current head
 * sha is returned as-is unless `force`. Otherwise a new run starts detached.
 */
export async function startRun(cfg: Config, prId: PrId, opts: { force?: boolean } = {}): Promise<StartResult> {
  const ref = parsePrId(prId);
  if (!ref) throw new Error(`malformed prId: ${prId}`);

  const detail = await fetchPrDetail(cfg, ref);
  if (!detail) throw new Error(`pull request not found: ${prId}`);
  const headSha = detail.pr.headSha;

  const existing = await getRun(prId, headSha);
  if (existing && !opts.force && existing.status !== 'stale' && existing.status !== 'failed') {
    return { run: existing, started: false };
  }

  const run: AgentRun = {
    id: randomUUID(),
    prId,
    headSha,
    status: 'queued',
    findings: [],
    tokensUsed: 0,
    costUsd: 0,
    startedAt: new Date().toISOString(),
  };
  await upsertRun(run);
  const signal = createLive(run.id, prId);

  // Detached: the HTTP response returns the queued snapshot; SSE follows along.
  void driveRun(cfg, run, ref, detail, signal).catch((e) => {
    console.error(`[pipeline] run ${run.id} crashed:`, e);
  });

  return { run, started: true };
}

async function driveRun(cfg: Config, run: AgentRun, ref: PrRef, detail: PrDetail, signal: AbortSignal): Promise<void> {
  const emit = (event: RunEvent) => publish(run.id, event);
  const settings = await loadSettings();

  const persist = async (patch: Partial<AgentRun>) => {
    Object.assign(run, patch);
    await upsertRun(run);
  };

  try {
    const result = await executePipeline(cfg, settings, run, ref, detail, signal, emit);
    await persist(result);
    await addSpend(result.costUsd ?? 0);
    emit({ type: 'done', run });
  } catch (e) {
    const message = signal.aborted ? 'cancelled' : e instanceof Error ? e.message : String(e);
    await persist({ status: 'failed', error: message, finishedAt: new Date().toISOString() });
    emit({ type: 'error', message });
    emit({ type: 'done', run });
  } finally {
    finishLive(run.id);
  }
}

async function executePipeline(
  cfg: Config,
  settings: TandemSettings,
  run: AgentRun,
  ref: PrRef,
  detail: PrDetail,
  signal: AbortSignal,
  emit: (event: RunEvent) => void
): Promise<Partial<AgentRun>> {
  const { pr, threads } = detail;
  const now = () => new Date().toISOString();

  emit({ type: 'status', status: 'fetching', detail: 'reading changed files' });
  run.status = 'fetching';
  await upsertRun(run);

  const files = await fetchPrFiles(cfg, ref, signal);
  const analyzable = analyzableFiles(files);

  const skip = skipDecision(
    {
      isDraft: pr.isDraft,
      changedFiles: pr.changedFiles,
      diffLines: countDiffLines(files),
      allGenerated: analyzable.length === 0,
      agentEnabled: agentEnabledFor(settings, `${ref.owner}/${ref.repo}`),
      spentTodayUsd: await spendToday(),
    },
    settings
  );
  if (skip.skip) {
    emit({ type: 'status', status: 'skipped', detail: skip.reason });
    return { status: 'skipped', skipReason: skip.reason, finishedAt: now() };
  }

  emit({ type: 'status', status: 'analyzing' });
  run.status = 'analyzing';
  await upsertRun(run);

  const conventions = await fetchConventions(cfg, ref, pr.headSha);
  const commitSubjects = await fetchRecentCommitSubjects(cfg, ref, pr.baseRef);

  let tokens = 0;
  let cost = 0;
  const track = (r: Extract<ClaudePassResult, { ok: true }>) => {
    tokens += r.tokens;
    cost += r.costUsd;
    emit({ type: 'usage', tokens, costUsd: cost });
  };

  // --- Pass 1: orient (cheap model) ---
  emit({ type: 'pass', pass: 1, label: 'orienting' });
  const planResult = await validatedPass(
    buildOrientPrompt({ pr, files, conventions, commitSubjects }),
    settings.models.orient,
    Pass1PlanSchema,
    signal,
    track
  );
  // A failed orient degrades to a generic plan rather than failing the run —
  // pass 2 carries the real weight.
  const plan: Pass1Plan = planResult.ok
    ? planResult.value
    : { checks: ['correctness of the changed logic', 'error handling and edge cases', 'API/contract changes', 'test coverage of new behavior'] };

  // --- Pass 2: analyze, per cluster (respects model-authored clusters when sane) ---
  const clusters = clustersFromPlan(plan, analyzable) ?? clusterFiles(analyzable);
  const candidates: FindingJson[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (signal.aborted) throw new Error('cancelled');
    emit({ type: 'pass', pass: 2, label: `analyzing ${i + 1}/${clusters.length}` });
    const passResult = await validatedPass(
      buildAnalyzePrompt({ pr, plan, files: clusters[i], conventions }),
      settings.models.analyze,
      Pass2OutputSchema,
      signal,
      track
    );
    if (passResult.ok) candidates.push(...passResult.value.findings);
    else console.error(`[pipeline] pass 2 cluster ${i} unusable after repair: ${passResult.errors}`);
  }

  const lineIndex = new Map<string, DiffLineIndex>(analyzable.map((f) => [f.path, diffLineIndex(f.patch!)]));
  const sanitized = sanitizeFindings(candidates, lineIndex, threads);

  // --- Pass 3: reconcile — the pass that keeps output signal-dense. Do not skip. ---
  emit({ type: 'pass', pass: 3, label: 'reconciling' });
  const reconcileResult = await validatedPass(
    buildReconcilePrompt({ pr, candidates: sanitized.kept, threads, findingCap: settings.findingCap, nitCap: settings.nitCap }),
    settings.models.reconcile,
    Pass3OutputSchema,
    signal,
    track
  );
  if (!reconcileResult.ok) {
    // Fail visibly rather than showing degraded output (spec §4).
    return { status: 'failed', error: `reconcile output invalid: ${reconcileResult.errors}`, tokensUsed: tokens, costUsd: cost, finishedAt: now() };
  }

  // The model was told the rules; the code enforces them anyway.
  const finalSanitized = sanitizeFindings(reconcileResult.value.findings, lineIndex, threads);
  const capped = capFindings(finalSanitized.kept, settings.findingCap, settings.nitCap);
  const findings: Finding[] = capped.map((f) => ({
    ...f,
    id: randomUUID(),
    runId: run.id,
    prId: run.prId,
    headSha: run.headSha,
    state: 'proposed',
  }));

  const discardedTotal = sanitized.discarded + finalSanitized.discarded;
  if (discardedTotal > 0) console.error(`[pipeline] run ${run.id}: discarded ${discardedTotal} unanchored/duplicate findings`);

  return {
    status: 'ready',
    summary: reconcileResult.value.summary,
    findings,
    tokensUsed: tokens,
    costUsd: cost,
    finishedAt: now(),
  };
}

/** Run one pass; on schema failure, one repair attempt, then give up (spec §4). */
async function validatedPass<T>(
  prompt: string,
  model: string,
  schema: ZodType<T>,
  signal: AbortSignal,
  track: (r: Extract<ClaudePassResult, { ok: true }>) => void
): Promise<ParseResult<T>> {
  const first = await runClaudePass({ prompt, model, signal });
  if (!first.ok) return { ok: false, errors: first.error };
  track(first);
  const parsed = parseWithSchema(first.text, schema);
  if (parsed.ok) return parsed;

  const repair = await runClaudePass({ prompt: buildRepairPrompt(first.text, parsed.errors), model, signal });
  if (!repair.ok) return { ok: false, errors: `${parsed.errors} (repair failed: ${repair.error})` };
  track(repair);
  return parseWithSchema(repair.text, schema);
}

/** Pass-1 clusters, kept only when every named path is actually analyzable. */
function clustersFromPlan(plan: Pass1Plan, analyzable: FileChange[]): FileChange[][] | null {
  if (!plan.clusters || plan.clusters.length === 0) return null;
  const byPath = new Map(analyzable.map((f) => [f.path, f]));
  const clusters: FileChange[][] = [];
  const seen = new Set<string>();
  for (const group of plan.clusters) {
    const cluster: FileChange[] = [];
    for (const path of group) {
      const file = byPath.get(path);
      if (file && !seen.has(path)) {
        cluster.push(file);
        seen.add(path);
      }
    }
    if (cluster.length) clusters.push(cluster);
  }
  const leftovers = analyzable.filter((f) => !seen.has(f.path));
  if (leftovers.length) clusters.push(...clusterFiles(leftovers));
  return clusters.length ? clusters : null;
}

/** Staleness sweep, called when a PR's head moves (spec §2). */
export async function sweepStaleRun(prId: PrId, oldHeadSha: string): Promise<void> {
  await markRunStale(prId, oldHeadSha);
}
