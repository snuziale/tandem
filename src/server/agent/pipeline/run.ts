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
import { parsePrId, repoKeyOfRef, type PrRef } from "../../../shared/gh/prKey";
import type { FileChange, PrDetail, PrId } from "../../../shared/review-types";
import {
  agentById,
  effectiveContext,
  type AgentProfile,
  type TandemSettings,
} from "../../../shared/settings-types";
import {
  budgetFiles,
  neighbourhoodPaths,
  pickContextPaths,
  toolTargetOf,
  type ContextFile,
} from "../../../shared/agent-context";
import type { Config } from "../../config/store";
import { fetchPrFiles } from "../../github/files";
import { fetchPrDetail } from "../../github/pr";
import { quickApprove } from "../../github/submit";
import { loadReview } from "../../reviews/store";
import { loadSettings } from "../../settings/store";
import { agentEnabledFor } from "../../../shared/settings-types";
import { runClaudePass, type CheckoutAccess, type ToolTurn } from "../claude";
import { acquireWorktree, readCheckoutFile } from "../worktree";
import { createLive, finishLive, publish } from "../live";
import {
  addSpend,
  getRun,
  markRunStale,
  spendToday,
  upsertRun,
} from "../runsIndex";
import { analyzableFiles, clusterFiles } from "../../../shared/agent-cluster";
import {
  fetchFilesAt,
  fetchRecentCommitSubjects,
  fetchRepoGuidance,
  fetchTreePaths,
} from "./context";
import { skipDecision } from "../../../shared/agent-decide";
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

// Context budgets for a `files`-depth run, in characters (~4 per token). A
// cluster is ≤800 diff lines, so its own files in full dominate; related files
// are the SAME for every cluster, so they are capped tighter.
const CLUSTER_FILES_BUDGET = { perFile: 40_000, total: 120_000 };
const RELATED_FILES_BUDGET = { perFile: 20_000, total: 60_000 };
/** How many files outside the diff pass 1 may ask for, and how big a menu
 * it picks them from. */
const MAX_RELATED_FILES = 8;
const NEARBY_MENU = 150;
/** Turn cap for a pass exploring a checkout. Each tool call is a turn; the
 * final answer is one more. */
const CHECKOUT_MAX_TURNS = 30;

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
  const signal = createLive(run.id, prId, "run", {
    headSha,
    agentName: agent.name,
  });

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
      agentEnabled: agentEnabledFor(settings, repoKeyOfRef(ref)),
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

  // How much of the codebase this run gets to see. A checkout that cannot be
  // made degrades to whole files through GitHub rather than failing the run.
  let ctx = effectiveContext(settings, agent, repoKeyOfRef(ref));
  const checkoutStep =
    ctx.depth === "repo"
      ? await begin({
          id: "checkout",
          label: `checking out ${pr.headSha.slice(0, 7)}`,
        })
      : null;
  // Independent reads, together: the checkout (possibly a fetch) is the slow
  // one, and nothing else waits on it.
  const [guidance, commitSubjects, checkout, firstTree] = await Promise.all([
    fetchRepoGuidance(cfg, ref, pr.headSha),
    fetchRecentCommitSubjects(cfg, ref, pr.baseRef),
    ctx.depth === "repo"
      ? acquireWorktree(ctx.localPath, ref, pr.headSha).then(
          (worktree) => ({ worktree }),
          (e: unknown) => ({
            error: e instanceof Error ? e.message : String(e),
          }),
        )
      : null,
    ctx.depth === "files" ? fetchTreePaths(cfg, ref, pr.headSha) : null,
  ]);
  let tree = firstTree;
  const worktree =
    checkout && "worktree" in checkout ? checkout.worktree : null;
  if (checkoutStep && checkout && "error" in checkout) {
    await checkoutStep.failed(
      `${checkout.error} — reading whole files through GitHub instead`,
    );
    ctx = { depth: "files" };
    tree = await fetchTreePaths(cfg, ref, pr.headSha);
  } else if (checkoutStep && ctx.depth === "repo") {
    await checkoutStep.done(`read-only worktree of ${ctx.localPath}`);
  }

  try {
    let tokens = 0;
    let cost = 0;
    const track = (r: { tokens: number; costUsd: number }) => {
      tokens += r.tokens;
      cost += r.costUsd;
      // Onto the run too — the next step's write persists it, so a reload
      // mid-run (and a failed run) reports what was actually spent.
      run.tokensUsed = tokens;
      run.costUsd = cost;
      emit({ type: "usage", tokens, costUsd: cost });
    };

    // Only a `files` run offers pass 1 a menu (tree is null otherwise): a
    // `diff` run reads nothing extra, and a `repo` run's analyze pass opens
    // what it needs for itself.
    const nearby = tree
      ? neighbourhoodPaths(
          tree,
          analyzable.map((f) => f.path),
          NEARBY_MENU,
        )
      : [];
    // The changed files do not depend on the plan, so their fetch runs WHILE
    // pass 1 thinks. An added file's patch already IS the whole file.
    const headPaths =
      ctx.depth === "files"
        ? analyzable
            .filter((f) => f.status !== "removed" && f.status !== "added")
            .map((f) => f.path)
        : [];
    const headFetch = fetchFilesAt(cfg, ref, pr.headSha, headPaths, signal);
    headFetch.catch(() => {}); // awaited below; an abort must not go unhandled

    // --- Pass 1: orient (cheap model) ---
    const orientStep = await begin({
      id: "orient",
      pass: 1,
      label: "orienting",
    });
    const planResult = await validatedPass(
      buildOrientPrompt({
        prompts: agent.prompts,
        pr,
        files,
        guidance,
        commitSubjects,
        nearby,
        maxContext: MAX_RELATED_FILES,
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

    // --- Context: whole files through GitHub (`files` depth only) ---
    // Picks are checked against the menu pass 1 was SHOWN, not the whole tree.
    const relatedPaths = pickContextPaths(
      plan.context,
      new Set(nearby),
      new Set(files.map((f) => f.path)),
      MAX_RELATED_FILES,
    );
    let wholeByPath = new Map<string, ContextFile>();
    let related: ContextFile[] = [];
    if (ctx.depth === "files") {
      const contextStep = await begin({
        id: "context",
        label: "reading whole files",
        paths: [...headPaths, ...relatedPaths],
      });
      const [head, rel] = await Promise.all([
        headFetch,
        fetchFilesAt(cfg, ref, pr.headSha, relatedPaths, signal),
      ]);
      wholeByPath = new Map(head.map((f) => [f.path, f]));
      related = rel;
      const note =
        ctx.degraded === "no-local-path"
          ? " · no local clone configured, so no checkout"
          : "";
      await contextStep.done(
        `${head.length} changed + ${rel.length} related files${note}`,
      );
    }
    // Empty for any depth but `files`, which renders as no block at all.
    const relatedBudgeted = budgetFiles(related, RELATED_FILES_BUDGET);

    // Built once per run: what the analyze prompt says about the checkout,
    // and what the harness is given to run in it.
    const checkoutNote = worktree
      ? {
          repo: repoKeyOfRef(ref),
          sha: pr.headSha,
          maxTurns: CHECKOUT_MAX_TURNS,
        }
      : undefined;
    const checkoutAccess = worktree
      ? { cwd: worktree.path, maxTurns: CHECKOUT_MAX_TURNS }
      : undefined;
    const analyze = (
      prompt: Parameters<typeof buildAnalyzePrompt>[0],
      access?: PassAccess,
    ) =>
      validatedPass(
        buildAnalyzePrompt(prompt),
        agent.models.analyze,
        Pass2OutputSchema,
        signal,
        track,
        access,
      );

    // --- Pass 2: analyze, per cluster (respects model-authored clusters when sane) ---
    const clusters =
      clustersFromPlan(plan, analyzable) ?? clusterFiles(analyzable);
    const candidates: FindingJson[] = [];
    const failedPaths: string[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (signal.aborted) throw new Error("cancelled");
      const cluster = clusters[i];
      const clusterStep = await begin({
        id: `analyze:${i}`,
        pass: 2,
        label: `analyzing ${i + 1}/${clusters.length}`,
        paths: cluster.map((f) => f.path),
      });
      const basePrompt = {
        prompts: agent.prompts,
        pr,
        plan,
        files: cluster,
        guidance,
        fullFiles: budgetFiles(
          cluster.flatMap((f) => wholeByPath.get(f.path) ?? []),
          CLUSTER_FILES_BUDGET,
        ),
        related: relatedBudgeted,
      };
      let toolCalls = 0;
      let passResult = await analyze(
        { ...basePrompt, checkout: checkoutNote },
        checkoutAccess && {
          checkout: checkoutAccess,
          onToolTurn: ({ uses }) => {
            toolCalls += uses.length;
            for (const use of uses) {
              const path = toolTargetOf(use.input, checkoutAccess.cwd);
              if (path) clusterStep.reading(path);
            }
          },
        },
      );
      // An exploring pass that ran out of turns has nothing to show for them.
      // Re-ask on the `files` rung — the cluster's files read straight off the
      // checkout's disk — rather than losing the cluster or dropping to hunks.
      let fallback = "";
      if (checkoutAccess && !passResult.ok && !signal.aborted) {
        fallback = ` · checkout pass failed (${passResult.errors}), answered from whole files`;
        const local = await Promise.all(
          cluster.map(async (f) => {
            const text = await readCheckoutFile(checkoutAccess.cwd, f.path);
            return text === null ? [] : [{ path: f.path, text }];
          }),
        );
        passResult = await analyze({
          ...basePrompt,
          fullFiles: budgetFiles(local.flat(), CLUSTER_FILES_BUDGET),
        });
      }
      if (passResult.ok) {
        candidates.push(...passResult.value.findings);
        const reads = toolCalls ? ` · ${toolCalls} tool calls` : "";
        await clusterStep.done(
          `${passResult.value.findings.length} candidates${reads}${fallback}`,
        );
      } else {
        console.error(
          `[pipeline] pass 2 cluster ${i} unusable after repair: ${passResult.errors}`,
        );
        failedPaths.push(...cluster.map((f) => f.path));
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
        coverage: {
          analyzed: analyzable,
          failedPaths,
          dropped: sanitized.discarded,
        },
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
  } finally {
    worktree?.release();
  }
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
  // ONLY the default profile can approve. A specialized lens legitimately
  // finds nothing outside its own subject — a performance sweep over a PR with
  // no performance problems scores high because it looked at one thing, not
  // because the change is sound. Letting that post an APPROVE would widen the
  // one sanctioned exception to "the agent never writes to GitHub" every time
  // someone adds a profile. `undefined` is a pre-profiles run: back then the
  // only reviewer WAS the default one.
  if (run.agentId !== undefined && run.agentId !== settings.defaultAgentId)
    return;
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
  /** A file the step just opened (a checkout pass's tool call). Emitted for
   * the live readout, persisted with the step's next settle. */
  reading: (path: string) => void;
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
      reading: (path: string) => {
        const paths = (step.paths ??= []);
        if (paths.includes(path)) return;
        paths.push(path);
        emit({ type: "step", step });
      },
    };
  };
}

type PassAccess = {
  checkout: CheckoutAccess;
  onToolTurn: (turn: ToolTurn) => void;
};

/** Run one pass; on schema failure, one repair attempt, then give up (spec §4).
 * With `access`, the FIRST attempt runs inside the checkout; the repair only
 * reshapes JSON it already wrote, so it never needs tools. */
async function validatedPass<T>(
  prompt: string,
  model: string,
  schema: ZodType<T>,
  signal: AbortSignal,
  track: (r: { tokens: number; costUsd: number }) => void,
  access?: PassAccess,
): Promise<ParseResult<T>> {
  const first = await runClaudePass({
    prompt,
    model,
    signal,
    checkout: access?.checkout,
    onToolTurn: access?.onToolTurn,
  });
  // A failed pass still spent — an exploring one, most of all.
  track(first);
  if (!first.ok) return { ok: false, errors: first.error };
  const parsed = parseWithSchema(first.text, schema);
  if (parsed.ok) return parsed;

  const repair = await runClaudePass({
    prompt: buildRepairPrompt(first.text, parsed.errors),
    model,
    signal,
  });
  track(repair);
  if (!repair.ok)
    return {
      ok: false,
      errors: `${parsed.errors} (repair failed: ${repair.error})`,
    };
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
