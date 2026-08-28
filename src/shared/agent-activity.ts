// What the agent is working on RIGHT NOW, reconciled from the two sources that
// know: the server's live registry (authoritative while a run is streaming,
// but in-memory) and the persisted run records (durable, but only as fresh as
// the last step write).
//
// Neither alone is enough. The registry misses a run owned by a SIBLING server
// — the native app and a dev server can share `$TANDEM_HOME`, and each has its
// own registry — so a run genuinely analyzing in the other process looks idle
// here. The run records miss chat turns, which have no run record at all.
//
// In `shared/` and executed SERVER-side, so the app, the menu-bar feed and
// anything else asking "is the agent busy?" get one answer rather than each
// reconciling its own way.
import {
  isActiveRun,
  isInterrupted,
  type AgentRun,
  type LiveWork,
  type RunStep,
} from "./agent-types";

/**
 * Live registry first (it knows what the current step is doing right now),
 * then any active run the registry does not have — newest first.
 *
 * An INTERRUPTED run is excluded: a record still marked `analyzing` long after
 * the process that started it vanished is not in flight, and the startup sweep
 * will fail it. Same window as that sweep (`isInterrupted`), so the strip and
 * the sweep cannot disagree about which runs are real.
 *
 * A run in both is not duplicated — the registry's entry wins, because a
 * persisted step lags the frame that produced it by one write.
 */
export function inFlightWork(
  live: readonly LiveWork[],
  runs: readonly AgentRun[],
  now: number = Date.now(),
): LiveWork[] {
  const known = new Set(live.map((work) => work.id));
  const orphans = runs
    .filter(
      (run) =>
        isActiveRun(run) && !known.has(run.id) && !isInterrupted(run, now),
    )
    .map(workFromRun);
  return [...live, ...orphans].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}

/** The best description of an active run available from its record alone. */
export function workFromRun(run: AgentRun): LiveWork {
  const step = currentStep(run.steps);
  return {
    id: run.id,
    kind: "run",
    prId: run.prId,
    headSha: run.headSha,
    agentName: run.agentName,
    pass: step?.pass,
    label: step?.label ?? statusLabel(run.status),
    paths: step?.paths,
    startedAt: run.startedAt ?? new Date(0).toISOString(),
    tokensUsed: run.tokensUsed,
    costUsd: run.costUsd,
  };
}

/** The running step if there is one, else the last thing that happened. */
function currentStep(steps: RunStep[] | undefined): RunStep | undefined {
  if (!steps || steps.length === 0) return undefined;
  const running = [...steps].reverse().find((s) => s.status === "running");
  return running ?? steps[steps.length - 1];
}

function statusLabel(status: AgentRun["status"]): string {
  if (status === "queued") return "waiting for a slot";
  if (status === "fetching") return "reading changed files";
  return "analyzing";
}

/**
 * What the agent did today, for the strip's idle readout. Computed here beside
 * the reconciliation so the header can be fed by one small response instead of
 * re-deriving it from the full run list on every poll.
 */
export type TodayTally = {
  runs: number;
  /** Findings still awaiting triage across ALL runs — a standing backlog. */
  openFindings: number;
  failed: number;
};

export function tallyToday(
  runs: readonly AgentRun[],
  now: number = Date.now(),
): TodayTally {
  const since = startOfDay(now);
  const tally: TodayTally = { runs: 0, openFindings: 0, failed: 0 };
  for (const run of runs) {
    for (const finding of run.findings)
      if (finding.state === "proposed" || finding.state === "edited")
        tally.openFindings++;
    const at = run.finishedAt ?? run.startedAt;
    if (!at || Date.parse(at) < since) continue;
    tally.runs++;
    if (run.status === "failed") tally.failed++;
  }
  return tally;
}

function startOfDay(now: number): number {
  const date = new Date(now);
  return +new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
