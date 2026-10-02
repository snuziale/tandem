// A macOS app launched from Finder or the Dock does not inherit the PATH your
// terminal has: launchd hands it /usr/bin:/bin:/usr/sbin:/sbin, so a claude
// CLI in ~/.local/bin, /opt/homebrew/bin or an nvm prefix is simply not found
// — the agent reads "not on PATH" in the app while working fine from
// `pnpm start`. The fix every Mac GUI tool converges on: ask the user's LOGIN
// shell once, at launch, what PATH it would have, and adopt it.
//
// Two Bun facts decide WHERE: a Worker does not see env changes its parent
// makes, so this runs in the server worker itself (worker.ts), which is what
// spawns claude and git; and Bun.which reads the PATH the process STARTED
// with, not process.env — so every lookup goes through `which()` below.

const MARKER = "__TANDEM_PATH__";
const TIMEOUT_MS = 3000;

/** The login shell's entries first (that is the order the user's terminal
 * resolves in), then anything the process already had that the shell did
 * not — so this can only ever ADD places to look, never lose one. */
export function mergePath(
  current: string | undefined,
  login: string,
  sep = ":",
): string {
  const out: string[] = [];
  for (const entry of [...login.split(sep), ...(current ?? "").split(sep)]) {
    if (entry && !out.includes(entry)) out.push(entry);
  }
  return out.join(sep);
}

/** Pull PATH out of shell output that may carry banners or rc-file noise:
 * everything after the marker, up to the end of that line. */
export function parseShellPath(output: string): string | null {
  const at = output.lastIndexOf(MARKER);
  if (at === -1) return null;
  const path = output
    .slice(at + MARKER.length)
    .split("\n")[0]
    .trim();
  return path || null;
}

/** Adopt the login shell's PATH. Best effort and bounded: a slow or broken
 * rc file costs at most TIMEOUT_MS and leaves PATH exactly as it was. */
export async function adoptLoginShellPath(): Promise<void> {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const proc = Bun.spawn([shell, "-ilc", `printf '${MARKER}%s\\n' "$PATH"`], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const output = await new Response(proc.stdout).text();
    clearTimeout(timer);
    const login = parseShellPath(output);
    if (login) process.env.PATH = mergePath(process.env.PATH, login);
  } catch (e) {
    console.error(
      `[app] could not read the login shell's PATH: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/** `Bun.which` against the CURRENT PATH (see the header). */
export function which(command: string): string | null {
  return Bun.which(command, { PATH: process.env.PATH ?? "" });
}
