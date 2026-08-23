// In-memory registry of RUNNING pipelines. Runs are owned by the server, not
// the HTTP connection (Sift's runStore invariant): closing the pane or
// reloading detaches; POST /api/runs/:id/cancel is the only kill switch.
// Completed runs live in runsIndex.ts; this holds only the live ones.
import type { RunEvent } from "../../shared/agent-types";

export type Subscriber = (event: RunEvent, serialized: string) => void;

type LiveRun = {
  runId: string;
  prId: string;
  events: RunEvent[];
  serialized: string[];
  subscribers: Set<Subscriber>;
  abort: AbortController;
};

const live = new Map<string, LiveRun>();

export function createLive(runId: string, prId: string): AbortSignal {
  const run: LiveRun = {
    runId,
    prId,
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
  return [...live.values()].map((r) => r.prId);
}

export function liveCount(): number {
  return live.size;
}

export function publish(runId: string, event: RunEvent): void {
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
