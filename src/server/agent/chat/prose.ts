// Splitting a chat turn's output into the prose the reviewer reads and the
// optional trailing action fence the server consumes.
//
// Two views of the same text: `createFenceGate` runs over the STREAM (suppress
// the action fence while it is still being typed), `splitTrailingJson` runs
// over the FINAL text (authoritative — it is what gets persisted). The gate is
// deliberately conservative: it only ever hides a ```json fence, so a ```ts
// snippet in the middle of an answer still streams.
const MARKER = "```json";

export type FenceGate = {
  /** Text safe to stream from this chunk (may be empty). */
  push: (chunk: string) => string;
  /** Anything held back at the end of a clean stream. */
  flush: () => string;
};

export function createFenceGate(): FenceGate {
  // Held back because it could still grow into MARKER across a chunk boundary.
  let held = "";
  let closed = false;
  return {
    push(chunk) {
      if (closed) return "";
      const buf = held + chunk;
      held = "";
      const idx = buf.indexOf(MARKER);
      if (idx >= 0) {
        closed = true;
        return buf.slice(0, idx);
      }
      for (let n = Math.min(MARKER.length - 1, buf.length); n > 0; n--) {
        const tail = buf.slice(buf.length - n);
        if (MARKER.startsWith(tail)) {
          held = tail;
          return buf.slice(0, buf.length - n);
        }
      }
      return buf;
    },
    flush() {
      if (closed) return "";
      const out = held;
      held = "";
      return out;
    },
  };
}

/**
 * Peel the trailing fence off a finished reply. Only the LAST fenced block
 * counts, only when nothing but blank lines follow it, and only when it parses
 * — a code block inside the answer stays in the prose where it belongs.
 *
 * Fences are walked line by line rather than matched with one regex: a `\`\`\``
 * closing an earlier block would otherwise read as the start of a new one.
 */
export function splitTrailingJson(text: string): {
  prose: string;
  tail: unknown | null;
} {
  const lines = text.split("\n");
  const opener = /^\s{0,3}```[A-Za-z0-9_-]*[ \t]*\r?$/;
  const closer = /^\s{0,3}```[ \t]*\r?$/;
  let openAt: number | null = null;
  let last: { open: number; close: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (openAt === null) {
      if (opener.test(lines[i])) openAt = i;
    } else if (closer.test(lines[i])) {
      last = { open: openAt, close: i };
      openAt = null;
    }
  }
  if (!last) return { prose: text.trim(), tail: null };
  // Anything but blank lines after the block means it is part of the answer.
  if (lines.slice(last.close + 1).some((l) => l.trim() !== ""))
    return { prose: text.trim(), tail: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.slice(last.open + 1, last.close).join("\n"));
  } catch {
    // Malformed tail: leave it visible rather than silently swallowing output.
    return { prose: text.trim(), tail: null };
  }
  return { prose: lines.slice(0, last.open).join("\n").trim(), tail: parsed };
}
