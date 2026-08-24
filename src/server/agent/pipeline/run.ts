// The three-pass pipeline orchestrator. One executeRun per (prId, headSha):
// orient → analyze (per cluster) → reconcile, all through the read-only
// claude CLI harness, findings validated and post-filtered before anything is
// stored. Runs are detached from HTTP (live.ts); results land in runsIndex.
import { randomUUID } from "node:crypto";
import type {
  AgentRun,
  Finding,
  RunEvent,
  RunStep,
  RunStepStatus,
} from "../../../shared/agent-types";
import {
  Pass1PlanSchema,
  Pass2OutputSchema,
  Pass3OutputSchema,
  type FindingJson,
  type Pass1Plan,
} from "../../../shared/finding-schema";
import {
  countDiffLines,
  diffLineIndex,
  type DiffLineIndex,
} from "../../../shared/gh/patch";
import { parsePrId, type PrRef } from "../../../shared/gh/prKey";
import type { FileChange, PrDetail, PrId } from "../../../shared/review-types";
import {
  agentById,
  type AgentProfile,
  type TandemSettings,
} from "../../../shared/settings-types";
import type { Config } from "../../config/store";
import { fetchPrFiles } from "../../github/files";
import { fetchPrDetail } from "../../github/pr";
import { quickApprove } from "../../github/submit";
import { loadReview } from "../../reviews/store";
import { agentEnabledFor, loadSettings } from "../../settings/store";
import { runClaudePass, type ClaudePassResult } from "../claude";
import { createLive, finishLive, publish } from "../live";
import {
  addSpend,
  getRun,
  markRunStale,
  spendToday,
  upsertRun,
} from "../runsIndex";
import { analyzableFiles, clusterFiles } from "./cluster";
import { fetchConventions, fetchRecentCommitSubjects } from "./context";
import { skipDecision } from "./decide";
import {
  parseWithSchema,
  sanitizeFindings,
  capFindings,
  type ParseResult,
} from "./parse";
import {
  buildAnalyzePrompt,
  buildOrientPrompt,
  buildReconcilePrompt,
  buildRepairPrompt,
} from "./prompts";
import type { ZodType } from "zod";

export type StartResult = { run: AgentRun; started: boolean };

/**
 * Idempotent entry point: an existing non-stale run for the PR's current head
 * sha is returned as-is unless `force`. Otherwise a new run starts detached.
 */
export async function startRun(
  cfg: Config,
  prId: PrId,
  opts: { force?: boolean; agentId?: string } = {},
): Promise<StartResult> {
  const ref = parsePrId(prId);
  if (!ref) throw new Error(`malformed prId: ${prId}`);

  const detail = await fetchPrDetail(cfg, ref);
  if (!detail) throw new Error(`pull request not found: ${prId}`);
  const headSha = detail.pr.headSha;

  const existing = await getRun(prId, headSha);
  if (
    existing &&
    !opts.force &&
    existing.status !== "stale" &&
    existing.status !== "failed"
  ) {
    return { run: existing, started: false };
  }

  const settings = await loadSettings();
  const agent = agentById(settings, opts.agentId);

  const run: AgentRun = {
    id: randomUUID(),
    prId,
    headSha,
    status: "queued",
    agentId: agent.id,
    agentName: agent.name,
    findings: [],
    tokensUsed: 0,
    costUsd: 0,
    startedAt: new Date().toISOString(),
  };
  await upsertRun(run);
  const signal = createLive(run.id, prId);

  // Detached: the HTTP response returns the queued snapshot; SSE follows along.
  void driveRun(cfg, settings, agent, run, ref, detail, signal).catch((e) => {
    console.error(`[pipeline] run ${run.id} crashed:`, e);
  });

  return { run, started: true };
}

async function driveRun(
  cfg: Config,
  settings: TandemSettings,
  agent: AgentProfile,
  run: AgentRun,
  ref: PrRef,
  detail: PrDetail,
  signal: AbortSignal,
): Promise<void> {
  const emit = (event: RunEvent) => publish(run.id, event);

  const persist = async (patch: Partial<AgentRun>) => {
    Object.assign(run, patch);
    await upsertRun(run);
  };

  // Passes that completed cost money whether or not the run did — the daily
  // ceiling must see it either way, and exactly once.
  let spendSettled = false;
  const settleSpend = async (usd: number) => {
    if (spendSettled) return;
    spendSettled = true;
    await addSpend(usd);
  };

  try {
    const result = await executePipeline(
      cfg,
      settings,
      agent,
      run,
      ref,
      detail,
      signal,
      emit,
    );
    await persist(result);
    await settleSpend(result.costUsd ?? 0);
    if (run.status === "ready")
      await maybeAutoApprove(cfg, settings, run, detail);
    emit({ type: "done", run });
  } catch (e) {
    const message = signal.aborted
      ? "cancelled"
      : e instanceof Error
        ? e.message
        : String(e);
    // Whatever was in flight died with the run: say so, rather than leaving a
    // step spinning forever in the timeline.
    for (const step of run.steps ?? []) {
      if (step.status !== "running") continue;
      step.status = "failed";
      step.detail = message;
      step.finishedAt = new Date().toISOString();
      emit({ type: "step", step });
    }
    await persist({
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    });
    await settleSpend(run.costUsd ?? 0);
    emit({ type: "error", message });
    emit({ type: "done", run });
  } finally {
    finishLive(run.id);
  }
}

async function executePipeline(
  cfg: Config,
  settings: TandemSettings,
  agent: AgentProfile,
  run: AgentRun,
  ref: PrRef,
  detail: PrDetail,
  signal: AbortSignal,
  emit: (event: RunEvent) => void,
): Promise<Partial<AgentRun>> {
  const { pr, threads } = detail;
  const now = () => new Date().toISOString();

  const begin = stepRecorder(run, emit);

  emit({ type: "status", status: "fetching", detail: "reading changed files" });
  run.status = "fetching";
  await upsertRun(run);

  const fetchStep = await begin({
    id: "fetch",
    label: "reading changed files",
  });
  const files = await fetchPrFiles(cfg, ref, signal);
  const analyzable = analyzableFiles(files);
  const diffLines = countDiffLines(files);
  await fetchStep.done(
    `${analyzable.length}/${files.length} files · ${diffLines} diff lines`,
  );

  const skip = skipDecision(
    {
      isDraft: pr.isDraft,
      changedFiles: pr.changedFiles,
      diffLines,
      allGenerated: analyzable.length === 0,
      agentEnabled: agentEnabledFor(settings, `${ref.owner}/${ref.repo}`),
      spentTodayUsd: await spendToday(),
    },
    settings,
  );
  if (skip.skip) {
    emit({ type: "status", status: "skipped", detail: skip.reason });
    return { status: "skipped", skipReason: skip.reason, finishedAt: now() };
  }

  emit({ type: "status", status: "analyzing" });
  run.status = "analyzing";
  await upsertRun(run);

  const conventions = await fetchConventions(cfg, ref, pr.headSha);
  const commitSubjects = await fetchRecentCommitSubjects(cfg, ref, pr.baseRef);

  let tokens = 0;
  let cost = 0;
  const track = (r: Extract<ClaudePassResult, { ok: true }>) => {
    tokens += r.tokens;
    cost += r.costUsd;
    // Onto the run too — the next step's write persists it, so a reload
    // mid-run (and a failed run) reports what was actually spent.
    run.tokensUsed = tokens;
    run.costUsd = cost;
    emit({ type: "usage", tokens, costUsd: cost });
  };

  // --- Pass 1: orient (cheap model) ---
  const orientStep = await begin({ id: "orient", pass: 1, label: "orienting" });
  const planResult = await validatedPass(
    buildOrientPrompt({
      prompts: agent.prompts,
      pr,
      files,
      conventions,
      commitSubjects,
    }),
    agent.models.orient,
    Pass1PlanSchema,
    signal,
    track,
  );
  // A failed orient degrades to a generic plan rather than failing the run —
  // pass 2 carries the real weight.
  const plan: Pass1Plan = planResult.ok
    ? planResult.value
    : {
        checks: [
          "correctness of the changed logic",
          "error handling and edge cases",
          "API/contract changes",
          "test coverage of new behavior",
        ],
      };
  // The plan is the most legible thing the run produces — what it set out to
  // look for. Persist it and say so, degraded or not.
  run.plan = plan.checks;
  emit({ type: "plan", checks: plan.checks, degraded: !planResult.ok });
  if (planResult.ok) await orientStep.done(`${plan.checks.length} checks`);
  else await orientStep.failed("model output unusable — generic plan");

  // --- Pass 2: analyze, per cluster (respects model-authored clusters when sane) ---
  const clusters =
    clustersFromPlan(plan, analyzable) ?? clusterFiles(analyzable);
  const candidates: FindingJson[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (signal.aborted) throw new Error("cancelled");
    const clusterStep = await begin({
      id: `analyze:${i}`,
      pass: 2,
      label: `analyzing ${i + 1}/${clusters.length}`,
      paths: clusters[i].map((f) => f.path),
    });
    const passResult = await validatedPass(
      buildAnalyzePrompt({
        prompts: agent.prompts,
        pr,
        plan,
        files: clusters[i],
        conventions,
      }),
      agent.models.analyze,
      Pass2OutputSchema,
      signal,
      track,
    );
    if (passResult.ok) {
      candidates.push(...passResult.value.findings);
      await clusterStep.done(`${passResult.value.findings.length} candidates`);
    } else {
      console.error(
        `[pipeline] pass 2 cluster ${i} unusable after repair: ${passResult.errors}`,
      );
      await clusterStep.failed("output unusable after repair");
    }
  }

  const lineIndex = new Map<string, DiffLineIndex>(
    analyzable.map((f) => [f.path, diffLineIndex(f.patch!)]),
  );
  const sanitized = sanitizeFindings(candidates, lineIndex, threads);

  // --- Pass 3: reconcile — the pass that keeps output signal-dense. Do not skip. ---
  const reconcileStep = await begin({
    id: "reconcile",
    pass: 3,
    label: "reconciling",
  });
  const reconcileResult = await validatedPass(
    buildReconcilePrompt({
      prompts: agent.prompts,
      pr,
      candidates: sanitized.kept,
      threads,
      findingCap: settings.findingCap,
      nitCap: settings.nitCap,
    }),
    agent.models.reconcile,
    Pass3OutputSchema,
    signal,
    track,
  );
  if (!reconcileResult.ok) {
    // Fail visibly rather than showing degraded output (spec §4).
    await reconcileStep.failed("output invalid after repair");
    return {
      status: "failed",
      error: `reconcile output invalid: ${reconcileResult.errors}`,
      tokensUsed: tokens,
      costUsd: cost,
      finishedAt: now(),
    };
  }

  // The model was told the rules; the code enforces them anyway.
  const finalSanitized = sanitizeFindings(
    reconcileResult.value.findings,
    lineIndex,
    threads,
  );
  const capped = capFindings(
    finalSanitized.kept,
    settings.findingCap,
    settings.nitCap,
  );
  const findings: Finding[] = capped.map((f) => ({
    ...f,
    id: randomUUID(),
    runId: run.id,
    prId: run.prId,
    headSha: run.headSha,
    state: "proposed",
  }));

  const discardedTotal = sanitized.discarded + finalSanitized.discarded;
  if (discardedTotal > 0)
    console.error(
      `[pipeline] run ${run.id}: discarded ${discardedTotal} unanchored/duplicate findings`,
    );

  await reconcileStep.done(
    `${findings.length} findings · score ${reconcileResult.value.score}`,
  );

  return {
    status: "ready",
    summary: reconcileResult.value.summary,
    score: reconcileResult.value.score,
    findings,
    tokensUsed: tokens,
    costUsd: cost,
    finishedAt: now(),
  };
}

/**
 * The ONE sanctioned unattended GitHub write, and only because the user
 * explicitly opted in (settings.autoApprove.enabled defaults to false).
 * Every gate must hold:
 *   opt-in ON · not a draft · pass-3 score ≥ threshold · zero undismissed
 *   blocker/risk findings · checks green (unless waived) · no human draft
 *   in progress for this PR (never preempt a review someone started).
 * GitHub itself refuses self-approval (422) — logged, not surfaced.
 */
async function maybeAutoApprove(
  cfg: Config,
  settings: TandemSettings,
  run: AgentRun,
  detail: PrDetail,
): Promise<void> {
  const gate = settings.autoApprove;
  if (!gate.enabled) return;
  const pr = detail.pr;
  if (pr.isDraft) return;
  if (run.score === undefined || run.score < gate.minScore) return;
  const blocking = run.findings.some(
    (f) =>
      (f.severity === "blocker" || f.severity === "risk") &&
      f.state !== "dismissed",
  );
  if (blocking) return;
  if (gate.requireChecksPassing && pr.checkRollup !== "SUCCESS") return;
  const draft = await loadReview(run.prId);
  if (draft && (draft.comments.length > 0 || draft.verdict)) return;

  const ref = parsePrId(run.prId);
  if (!ref) return;
  try {
    await quickApprove(cfg.github, ref);
    run.autoApproved = true;
    await upsertRun(run);
    console.error(
      `[pipeline] auto-approved ${run.prId} (score ${run.score} ≥ ${gate.minScore})`,
    );
  } catch (e) {
    console.error(
      `[pipeline] auto-approve failed for ${run.prId}: ${e instanceof Error ? e.message : e}`,
    );
  }
}

type StepHandle = {
  done: (detail?: string) => Promise<void>;
  failed: (detail: string) => Promise<void>;
};

/**
 * Records the run's timeline as it happens. Every step is BOTH emitted (for the
 * pane watching live) and persisted on the run (for a reload mid-run and for
 * the post-mortem after the live buffer is gone) — one source of truth, read
 * two ways.
 */
function stepRecorder(
  run: AgentRun,
  emit: (event: RunEvent) => void,
): (init: Omit<RunStep, "status" | "startedAt">) => Promise<StepHandle> {
  const steps: RunStep[] = [];
  run.steps = steps;

  return async function begin(init) {
    const step: RunStep = {
      ...init,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    steps.push(step);
    // Safe to publish the live object and mutate it later: publish() stringifies
    // on the spot, so each frame is a snapshot.
    emit({ type: "step", step });
    await upsertRun(run);

    const settle = async (status: RunStepStatus, detail?: string) => {
      step.status = status;
      step.finishedAt = new Date().toISOString();
      if (detail !== undefined) step.detail = detail;
      emit({ type: "step", step });
      await upsertRun(run);
    };
    return {
      done: (detail?: string) => settle("done", detail),
      failed: (detail: string) => settle("failed", detail),
    };
  };
}

/** Run one pass; on schema failure, one repair attempt, then give up (spec §4). */
async function validatedPass<T>(
  prompt: string,
  model: string,
  schema: ZodType<T>,
  signal: AbortSignal,
  track: (r: Extract<ClaudePassResult, { ok: true }>) => void,
): Promise<ParseResult<T>> {
  const first = await runClaudePass({ prompt, model, signal });
  if (!first.ok) return { ok: false, errors: first.error };
  track(first);
  const parsed = parseWithSchema(first.text, schema);
  if (parsed.ok) return parsed;

  const repair = await runClaudePass({
    prompt: buildRepairPrompt(first.text, parsed.errors),
    model,
    signal,
  });
  if (!repair.ok)
    return {
      ok: false,
      errors: `${parsed.errors} (repair failed: ${repair.error})`,
    };
  track(repair);
  return parseWithSchema(repair.text, schema);
}

/** Pass-1 clusters, kept only when every named path is actually analyzable. */
function clustersFromPlan(
  plan: Pass1Plan,
  analyzable: FileChange[],
): FileChange[][] | null {
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
export async function sweepStaleRun(
  prId: PrId,
  oldHeadSha: string,
): Promise<void> {
  await markRunStale(prId, oldHeadSha);
}
