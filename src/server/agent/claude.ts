// The one place Tandem invokes the claude CLI. Every pipeline pass is a
// single headless one-shot: prompt in over stdin, strict-JSON answer out of
// the final `result` frame. Read-only is enforced at the CLI layer — an empty
// toolset plus safe mode — matching the spec's "no write tools exist"
// requirement (§4): the model cannot touch the filesystem, network, or shell.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isPlainObject } from "../../shared/isPlainObject";
import { readLines } from "./procStream";

function tandemHome(): string {
  return Bun.env.TANDEM_HOME ?? join(homedir(), ".tandem");
}

export type ClaudePassResult =
  | { ok: true; text: string; tokens: number; costUsd: number }
  | { ok: false; error: string };

const PASS_TIMEOUT_MS = 10 * 60_000;
const MAX_STDERR_LINES = 50;

export function buildClaudeArgs(model?: string): string[] {
  const args = [
    "claude",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--safe-mode",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];
  // Discrete argv entry, no shell — no flag injection.
  if (model) args.push("--model", model);
  return args;
}

export async function runClaudePass(opts: {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<ClaudePassResult> {
  const sandbox = join(tandemHome(), "sandbox");
  await mkdir(sandbox, { recursive: true, mode: 0o700 });

  const proc = Bun.spawn(buildClaudeArgs(opts.model), {
    cwd: sandbox,
    stdin: new Blob([opts.prompt]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

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
      if (frame.kind === "result") {
        result = {
          ok: true,
          text: frame.text,
          tokens: frame.tokens,
          costUsd: frame.costUsd,
        };
      } else if (frame.kind === "error") {
        result = { ok: false, error: frame.message };
      }
    }
    const exitCode = await proc.exited;
    await stderrDone;
    appendLog(opts.model, stderrLines);
    if (opts.signal?.aborted) return { ok: false, error: "cancelled" };
    if (result) return result;
    const digest =
      stderrLines.slice(-5).join(" · ") ||
      `claude exited ${exitCode} with no result frame`;
    return { ok: false, error: digest };
  } finally {
    clearTimeout(killTimer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

type Frame =
  | { kind: "result"; text: string; tokens: number; costUsd: number }
  | { kind: "error"; message: string };

function parseFrame(line: string): Frame | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(obj) || obj.type !== "result") return null;
  if (typeof obj.subtype === "string" && obj.subtype.startsWith("error_")) {
    return {
      kind: "error",
      message:
        obj.subtype === "error_max_turns"
          ? "claude: max turns reached"
          : `claude: ${obj.subtype}`,
    };
  }
  const text = typeof obj.result === "string" ? obj.result : "";
  const usage = isPlainObjectRecord(obj.usage) ? obj.usage : {};
  const tokens = sumTokens(usage);
  // Subscription-billed runs report 0 here — the UI falls back to tokens.
  const costUsd =
    typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : 0;
  return { kind: "result", text, tokens, costUsd };
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
  const path = join(tandemHome(), "claude.log");
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
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0)
      return { available: false, error: `claude --version exited ${code}` };
    return { available: true, version: out.trim() };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : "claude CLI not found on PATH",
    };
  }
}
