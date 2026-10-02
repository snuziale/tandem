// The one place Tandem invokes the claude CLI. Every pipeline pass is a
// single headless one-shot: prompt in over stdin, strict-JSON answer out of
// the final `result` frame. Read-only is enforced at the CLI layer, matching
// the spec's "no write tools exist" requirement (§4), in one of two shapes:
//
// - DEFAULT: an empty toolset plus safe mode, run from an empty sandbox dir.
//   The model cannot touch the filesystem, network, or shell.
// - CHECKOUT (a `repo`-context profile): cwd is a throwaway git worktree at
//   the PR's head sha, and the toolset is exactly READ_ONLY_TOOLS. The set is
//   a code constant, never a setting. `--restricted` confines those tools to
//   the cwd (verified: a Read of /etc/hosts is refused) and removes every
//   code-running tool; `--strict-mcp-config` with no config loads no MCP
//   server. There is still no write tool, no shell and no network.
import { mkdir } from "node:fs/promises";
import { isPlainObject } from "../../shared/is-plain-object";
import { storagePath } from "../storage/jsonFile";
import { readLines } from "./procStream";

// `claude` is an npm shim on Windows (claude.cmd / claude.ps1), not a PE
// binary: CreateProcess cannot run a bare "claude" argv[0] there, so every
// spawn below would fail with ENOENT however well the CLI is installed.
// Bun.which applies PATHEXT and hands back the shim's absolute path, and Bun's
// spawn knows to route a .cmd/.bat argv[0] through cmd.exe with its own
// argument escaping — which is why we pass a PATH and never assemble a
// `cmd /c` command line ourselves (that would re-parse our arguments and
// reintroduce exactly the injection the discrete-argv note below rules out).
// A hit is cached; a miss is re-probed, since Bun.which is a directory scan
// rather than a process spawn and the CLI may be installed mid-session.
let cachedBin: string | null = null;

export function claudeBin(): string {
  if (!cachedBin) cachedBin = Bun.which("claude");
  return cachedBin ?? "claude";
}

export type ClaudePassResult =
  | { ok: true; text: string; tokens: number; costUsd: number }
  | {
      ok: false;
      error: string;
      /** What a failed pass still cost (0 when unknown) — an agentic pass
       * that hit its turn cap has usually spent the most of any. Required so
       * `track(result)` counts it without every caller defending a `?? 0`. */
      tokens: number;
      costUsd: number;
    };

/** The ONLY tools a pass ever gets, and only inside a checkout. Nothing that
 * writes, runs code, or reaches the network. */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/** A read-only checkout for the pass to explore. */
export type CheckoutAccess = { cwd: string; maxTurns: number };

export type ToolUse = { name: string; input: Record<string, unknown> };

/** One finished assistant message that made tool calls. Any prose it carried
 * is NOT the answer — the CLI's result is the final message only. */
export type ToolTurn = { uses: ToolUse[] };

const PASS_TIMEOUT_MS = 10 * 60_000;
const MAX_STDERR_LINES = 50;

export function buildClaudeArgs(
  bin: string,
  model?: string,
  /** `checkout` is the ONE switch that grants tools, and only READ_ONLY_TOOLS. */
  opts: {
    partialMessages?: boolean;
    checkout?: Pick<CheckoutAccess, "maxTurns">;
  } = {},
): string[] {
  const args = [
    bin,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--safe-mode",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];
  if (opts.checkout) {
    args.push(
      "--tools",
      READ_ONLY_TOOLS.join(","),
      "--restricted",
      "--strict-mcp-config",
      "--max-turns",
      String(opts.checkout.maxTurns),
    );
  } else {
    args.push("--tools", "");
  }
  // Token-level deltas, for the chat pass only: the pipeline passes emit one
  // strict-JSON blob nobody watches arrive, so they skip the extra frames.
  if (opts.partialMessages) args.push("--include-partial-messages");
  // Discrete argv entry, no shell — no flag injection.
  if (model) args.push("--model", model);
  return args;
}

export async function runClaudePass(opts: {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  /** Provide to stream assistant text as it arrives (chat). Omit for the
   * pipeline passes — it turns on the CLI's partial-message frames. */
  onDelta?: (text: string) => void;
  /** Run inside a read-only checkout with READ_ONLY_TOOLS. Omitted = no
   * tools at all, from the empty sandbox. */
  checkout?: CheckoutAccess;
  /** Each assistant message that made tool calls, as it completes (checkout
   * only). */
  onToolTurn?: (turn: ToolTurn) => void;
}): Promise<ClaudePassResult> {
  let cwd = opts.checkout?.cwd;
  if (!cwd) {
    cwd = storagePath("sandbox");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
  }

  const proc = Bun.spawn(
    buildClaudeArgs(claudeBin(), opts.model, {
      partialMessages: !!opts.onDelta,
      checkout: opts.checkout,
    }),
    {
      cwd,
      stdin: new Blob([opts.prompt]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    },
  );

  const killTimer = setTimeout(() => proc.kill(), PASS_TIMEOUT_MS);
  const onAbort = () => proc.kill();
  opts.signal?.addEventListener("abort", onAbort);

  const stderrLines: string[] = [];
  const stderrDone = (async () => {
    for await (const line of readLines(proc.stderr)) {
      if (stderrLines.length < MAX_STDERR_LINES) stderrLines.push(line);
    }
  })();

  let result: ClaudePassResult | null = null;
  try {
    for await (const line of readLines(proc.stdout)) {
      const frame = parseFrame(line);
      if (!frame) continue;
      if (frame.kind === "delta") {
        opts.onDelta?.(frame.text);
      } else if (frame.kind === "tools") {
        opts.onToolTurn?.({ uses: frame.uses });
      } else if (frame.kind === "result") {
        result = {
          ok: true,
          text: frame.text,
          tokens: frame.tokens,
          costUsd: frame.costUsd,
        };
      } else if (frame.kind === "error") {
        result = {
          ok: false,
          error: frame.message,
          tokens: frame.tokens,
          costUsd: frame.costUsd,
        };
      }
    }
    const exitCode = await proc.exited;
    await stderrDone;
    appendLog(opts.model, stderrLines);
    if (opts.signal?.aborted)
      return { ok: false, error: "cancelled", tokens: 0, costUsd: 0 };
    if (result) return result;
    const digest =
      stderrLines.slice(-5).join(" · ") ||
      `claude exited ${exitCode} with no result frame`;
    return { ok: false, error: digest, tokens: 0, costUsd: 0 };
  } finally {
    clearTimeout(killTimer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

type Frame =
  | { kind: "result"; text: string; tokens: number; costUsd: number }
  | { kind: "delta"; text: string }
  | { kind: "tools"; uses: ToolUse[] }
  | { kind: "error"; message: string; tokens: number; costUsd: number };

export function parseFrame(line: string): Frame | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(obj)) return null;
  // Partial-message frames (chat only): content_block_delta carries the text.
  if (obj.type === "stream_event") {
    const text = textDeltaOf(obj.event);
    return text === null ? null : { kind: "delta", text };
  }
  // A whole assistant message: the only frame that carries a tool call's
  // complete input (partial frames stream it as JSON fragments).
  if (obj.type === "assistant") {
    const uses = toolUsesOf(obj.message);
    return uses.length ? { kind: "tools", uses } : null;
  }
  if (obj.type !== "result") return null;
  const usage = isPlainObjectRecord(obj.usage) ? obj.usage : {};
  const tokens = sumTokens(usage);
  // Subscription-billed runs report 0 here — the UI falls back to tokens.
  const costUsd =
    typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : 0;
  if (typeof obj.subtype === "string" && obj.subtype.startsWith("error_")) {
    return {
      kind: "error",
      message:
        obj.subtype === "error_max_turns"
          ? "claude: max turns reached"
          : `claude: ${obj.subtype}`,
      tokens,
      costUsd,
    };
  }
  const text = typeof obj.result === "string" ? obj.result : "";
  return { kind: "result", text, tokens, costUsd };
}

/** `{event: {type: "content_block_delta", delta: {type: "text_delta", text}}}`. */
function textDeltaOf(event: unknown): string | null {
  if (!isPlainObject(event) || event.type !== "content_block_delta")
    return null;
  const delta = event.delta;
  if (!isPlainObject(delta) || delta.type !== "text_delta") return null;
  return typeof delta.text === "string" ? delta.text : null;
}

function toolUsesOf(message: unknown): ToolUse[] {
  if (!isPlainObject(message) || !Array.isArray(message.content)) return [];
  const uses: ToolUse[] = [];
  for (const block of message.content) {
    if (
      isPlainObject(block) &&
      block.type === "tool_use" &&
      typeof block.name === "string"
    )
      uses.push({
        name: block.name,
        input: isPlainObject(block.input) ? block.input : {},
      });
  }
  return uses;
}

function isPlainObjectRecord(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v);
}

function sumTokens(usage: Record<string, unknown>): number {
  let total = 0;
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ]) {
    const v = usage[key];
    if (typeof v === "number") total += v;
  }
  return total;
}

function appendLog(model: string | undefined, stderrLines: string[]): void {
  if (stderrLines.length === 0) return;
  const path = storagePath("claude.log");
  const entry = `${new Date().toISOString()} model=${model ?? "default"}\n${stderrLines.join("\n")}\n`;
  // Best-effort append; a failed log write must never fail a run.
  Bun.file(path)
    .text()
    .catch(() => "")
    .then((existing) => Bun.write(path, existing + entry))
    .catch(() => {});
}

export async function checkClaudeAvailable(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  const bin = claudeBin();
  try {
    const proc = Bun.spawn([bin, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0)
      return { available: false, error: `${bin} --version exited ${code}` };
    return { available: true, version: out.trim() };
  } catch (e) {
    return {
      available: false,
      error:
        e instanceof Error
          ? `${bin}: ${e.message}`
          : "claude CLI not found on PATH",
    };
  }
}
