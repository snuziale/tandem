// The one implementation of replay-then-tail, shared by run streams and chat
// turns. Both follow server-owned work over SSE, so both need the same
// property: the replay of what already happened and the subscription to what
// happens next must be installed in ONE synchronous block, or an event
// published in between is lost.
import type { LiveEvent } from "./live";
import { isLive, replay, subscribe } from "./live";

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
}

export function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Stream one live id. `isTerminal` decides which event closes the stream;
 * `finalEvent` produces the single frame answered to a client that arrives
 * after the work finished (null → 404).
 */
export async function streamLive(
  id: string,
  isTerminal: (event: LiveEvent) => boolean,
  finalEvent: () => Promise<LiveEvent | null>,
): Promise<Response> {
  if (!isLive(id)) {
    const event = await finalEvent();
    if (!event) return new Response("Not Found", { status: 404 });
    return new Response(sseFrame(event), { headers: sseHeaders() });
  }

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat !== null) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by cancel()
        }
      };
      heartbeat = setInterval(
        () => write(`: heartbeat ${Date.now()}\n\n`),
        5_000,
      );

      for (const serialized of replay(id)) write(`data: ${serialized}\n\n`);
      unsubscribe = subscribe(id, (event, serialized) => {
        write(`data: ${serialized}\n\n`);
        if (isTerminal(event)) close();
      });
      if (!unsubscribe) close(); // finished between the isLive check and here
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat !== null) clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}
