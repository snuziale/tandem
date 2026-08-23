// Durable agent-run records, ~/.tandem/runs.json: one AgentRun per
// (prId, headSha) — the cache rule (spec §4) is this key: the same sha is
// never re-analyzed without an explicit rerun. Also holds the daily spend
// ledger. State transitions go through the guarded helpers here; illegal
// edges throw (RUN_EDGES / FINDING_EDGES in shared/agent-types.ts).
import {
  canTransitionFinding,
  canTransitionRun,
  type AgentRun,
  type Finding,
  type FindingState,
} from "../../shared/agent-types";
import { runKeyOf } from "../../shared/gh/prKey";
import { isPlainObject } from "../../shared/isPlainObject";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "runs.json";

function file(): string {
  return storagePath(FILE);
}

type RunsFile = {
  runs: Record<string, AgentRun>;
  spendByDay: Record<string, number>;
};

async function readAll(): Promise<RunsFile> {
  const text = await readTextFile(file());
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as unknown;
      if (isPlainObject(raw) && isPlainObject(raw.runs)) {
        return {
          runs: raw.runs as Record<string, AgentRun>,
          spendByDay: isPlainObject(raw.spendByDay)
            ? (raw.spendByDay as Record<string, number>)
            : {},
        };
      }
    } catch {
      console.error(
        `[runs] ${file()} is malformed; starting empty (file preserved until next write)`,
      );
    }
  }
  return { runs: {}, spendByDay: {} };
}

async function writeAll(all: RunsFile): Promise<void> {
  await writeTextFile(file(), JSON.stringify(all, null, 2));
}

export async function listRuns(): Promise<AgentRun[]> {
  const all = await readAll();
  return Object.values(all.runs);
}

export async function getRun(
  prId: string,
  headSha: string,
): Promise<AgentRun | null> {
  const all = await readAll();
  return all.runs[runKeyOf(prId, headSha)] ?? null;
}

export async function getRunById(runId: string): Promise<AgentRun | null> {
  const all = await readAll();
  return Object.values(all.runs).find((r) => r.id === runId) ?? null;
}

/** Insert or replace the record for the run's (prId, headSha). */
export async function upsertRun(run: AgentRun): Promise<void> {
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    all.runs[runKeyOf(run.prId, run.headSha)] = run;
    await writeAll(all);
  });
}

export async function transitionFinding(
  runId: string,
  findingId: string,
  to: FindingState,
): Promise<AgentRun> {
  return enqueueMutation(file(), async () => {
    const all = await readAll();
    const entry = Object.entries(all.runs).find(([, r]) => r.id === runId);
    if (!entry) throw new Error(`no run ${runId}`);
    const [key, run] = entry;
    const finding = run.findings.find((f) => f.id === findingId);
    if (!finding) throw new Error(`no finding ${findingId} in run ${runId}`);
    if (!canTransitionFinding(finding.state, to)) {
      throw new Error(`illegal finding transition ${finding.state} → ${to}`);
    }
    finding.state = to;
    all.runs[key] = run;
    await writeAll(all);
    return run;
  });
}

/**
 * Rewrite a finding's text in place — the apply half of a chat revision.
 * Only findings still in triage can be revised: `staged` text belongs to the
 * draft comment, so chat proposes a comment revision for those instead.
 * Advances proposed → edited (a human asked for the change; the finding is no
 * longer purely machine-authored).
 */
export async function reviseFinding(
  runId: string,
  findingId: string,
  patch: {
    title?: string;
    body?: string;
    severity?: Finding["severity"];
    suggestion?: string | null;
  },
): Promise<AgentRun> {
  return enqueueMutation(file(), async () => {
    const all = await readAll();
    const entry = Object.entries(all.runs).find(([, r]) => r.id === runId);
    if (!entry) throw new Error(`no run ${runId}`);
    const [key, run] = entry;
    const finding = run.findings.find((f) => f.id === findingId);
    if (!finding) throw new Error(`no finding ${findingId} in run ${runId}`);
    if (finding.state !== "proposed" && finding.state !== "edited") {
      throw new Error(
        `finding is ${finding.state} — revise the staged comment instead`,
      );
    }
    if (patch.title !== undefined) finding.title = patch.title;
    if (patch.body !== undefined) finding.body = patch.body;
    if (patch.severity !== undefined) finding.severity = patch.severity;
    if (patch.suggestion !== undefined)
      finding.suggestion = patch.suggestion ?? undefined;
    if (finding.state === "proposed") finding.state = "edited";
    all.runs[key] = run;
    await writeAll(all);
    return run;
  });
}

/**
 * Add a finding the conversation surfaced to an existing run. Anchoring and
 * schema checks happen in chat/actions.ts before this is ever called; the caps
 * do NOT apply — a human explicitly asked for this one.
 */
export async function appendFinding(
  runId: string,
  finding: Finding,
): Promise<AgentRun> {
  return enqueueMutation(file(), async () => {
    const all = await readAll();
    const entry = Object.entries(all.runs).find(([, r]) => r.id === runId);
    if (!entry) throw new Error(`no run ${runId}`);
    const [key, run] = entry;
    if (run.status !== "ready")
      throw new Error(`run ${runId} is ${run.status} — cannot add findings`);
    run.findings.push(finding);
    all.runs[key] = run;
    await writeAll(all);
    return run;
  });
}

/** Staleness sweep: mark a superseded sha's run + findings stale (spec §2). */
export async function markRunStale(
  prId: string,
  headSha: string,
): Promise<void> {
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    const run = all.runs[runKeyOf(prId, headSha)];
    if (!run || run.status === "stale") return;
    if (!canTransitionRun(run.status, "stale")) return;
    run.status = "stale";
    for (const finding of run.findings) {
      if (canTransitionFinding(finding.state, "stale")) finding.state = "stale";
    }
    await writeAll(all);
  });
}

export async function addSpend(
  usd: number,
  day: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  if (usd <= 0) return;
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    all.spendByDay[day] = (all.spendByDay[day] ?? 0) + usd;
    await writeAll(all);
  });
}

export async function spendToday(
  day: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const all = await readAll();
  return all.spendByDay[day] ?? 0;
}
