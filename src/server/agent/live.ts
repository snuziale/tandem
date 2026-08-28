// In-memory registry of RUNNING work — pipeline runs AND chat turns. Both are
// owned by the server, not the HTTP connection (Sift's runStore invariant):
// closing the pane or reloading detaches; the cancel route is the only kill
// switch. Completed runs live in runsIndex.ts, transcripts in chat/store.ts;
// this holds only what is in flight.
//
// One registry, two kinds: `kind` keeps chat turns out of the run accounting
// (prewarm's in-flight cap, the header's live count) while sharing one
// implementation of replay-then-tail.
import type { LiveWork, RunEvent, RunStep } from "../../shared/agent-types";
import type { ChatEvent } from "../../shared/chat-types";

export type LiveKind = "run" | "chat";
export type LiveEvent = RunEvent | ChatEvent;

export type Subscriber = (event: LiveEvent, serialized: string) => void;

/** What the caller knows at creation time that the event stream never says.
 * Everything else in a LiveWork is derived from the events themselves. */
export type LiveMeta = {
  /** Run: the sha under analysis. Chat: the scope's sha. */
  headSha?: string;
  agentName?: string;
};

type LiveRun = {
  runId: string;
  prId: string;
  kind: LiveKind;
  meta: LiveMeta;
  startedAt: string;
  events: LiveEvent[];
  serialized: string[];
  subscribers: Set<Subscriber>;
  abort: AbortController;
};

const live = new Map<string, LiveRun>();

export function createLive(
  runId: string,
  prId: string,
  kind: LiveKind = "run",
  meta: LiveMeta = {},
): AbortSignal {
  const run: LiveRun = {
    runId,
    prId,
    kind,
    meta,
    startedAt: new Date().toISOString(),
    events: [],
    serialized: [],
    subscribers: new Set(),
    abort: new AbortController(),
  };
  live.set(runId, run);
  return run.abort.signal;
}

export function isLive(runId: string): boolean {
  return live.has(runId);
}

export function livePrIds(): string[] {
  return [...live.values()].filter((r) => r.kind === "run").map((r) => r.prId);
}

export function liveCount(): number {
  return [...live.values()].filter((r) => r.kind === "run").length;
}

/**
 * Everything in flight, described well enough for the header strip and the
 * agent tray — newest first, so "the one thing on the strip" is the work that
 * started most recently.
 *
 * Derived, never recorded: the publishers push the same frames they always
 * did. That matters because `publish()` stringifies immediately and the
 * pipeline then MUTATES the step object it published (run.ts says so out
 * loud) — so the running step in `events` turns itself into a done step when
 * the pass finishes, and this reads the truth without a second bookkeeping
 * path that could disagree with the SSE stream.
 */
export function liveWork(): LiveWork[] {
  return [...live.values()]
    .map(describe)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function describe(run: LiveRun): LiveWork {
  const base: LiveWork = {
    id: run.runId,
    kind: run.kind,
    prId: run.prId,
    headSha: run.meta.headSha,
    agentName: run.meta.agentName,
    label: run.kind === "chat" ? "thinking" : "starting",
    startedAt: run.startedAt,
    tokensUsed: 0,
    costUsd: 0,
  };
  // `status` and `error` are spelled differently on the two event unions, so
  // the kind picks the reader rather than one function guessing per frame.
  return run.kind === "chat"
    ? describeChat(run.events as ChatEvent[], base)
    : describeRun(run.events as RunEvent[], base);
}

function describeRun(events: RunEvent[], work: LiveWork): LiveWork {
  let running: RunStep | undefined;
  let last: RunStep | undefined;
  for (const event of events) {
    if (event.type === "usage") {
      work.tokensUsed = event.tokens;
      work.costUsd = event.costUsd;
      continue;
    }
    if (event.type === "status" && event.detail) work.label = event.detail;
    if (event.type !== "step") continue;
    last = event.step;
    // Re-read every frame: an earlier step object may have been mutated to
    // done since it was pushed.
    running = event.step.status === "running" ? event.step : running;
  }
  if (running && running.status !== "running") running = undefined;
  const step = running ?? last;
  if (step) {
    work.label = step.label;
    work.pass = step.pass;
    work.paths = step.paths;
  }
  return work;
}

function describeChat(events: ChatEvent[], work: LiveWork): LiveWork {
  for (const event of events) {
    if (event.type === "status") work.label = event.label;
    if (event.type === "context") work.paths = event.paths;
  }
  return work;
}

export function publish(runId: string, event: LiveEvent): void {
  const run = live.get(runId);
  if (!run) return;
  // Stringify ONCE — reused for the replay buffer and every subscriber.
  const serialized = JSON.stringify(event);
  run.events.push(event);
  run.serialized.push(serialized);
  // Copy before notifying: a dead SSE controller unsubscribing mid-loop must
  // not take down its peers.
  for (const notify of [...run.subscribers]) {
    try {
      notify(event, serialized);
    } catch {
      // subscriber already torn down
    }
  }
}

export function subscribe(
  runId: string,
  notify: Subscriber,
): (() => void) | null {
  const run = live.get(runId);
  if (!run) return null;
  run.subscribers.add(notify);
  return () => run.subscribers.delete(notify);
}

export function replay(runId: string): string[] {
  return live.get(runId)?.serialized ?? [];
}

export function cancelLive(runId: string): boolean {
  const run = live.get(runId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/** Remove from the live registry (after the final event has been published). */
export function finishLive(runId: string): void {
  live.delete(runId);
}
