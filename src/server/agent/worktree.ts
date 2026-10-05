// Read-only checkouts for `repo`-context profiles: a detached git worktree of
// the reviewer's local clone at the PR's head sha, under $TANDEM_HOME.
//
// What this does to the clone, exhaustively: it may FETCH the PR's head
// (objects plus FETCH_HEAD — no branch, no ref of the reviewer's moves), and
// it registers a worktree in `.git/worktrees/`, removed again when idle. It
// never checks anything out in the clone's own working tree, never touches a
// branch, and never writes anywhere on GitHub. A worktree carries only
// TRACKED files, so the reviewer's untracked `.env` is not in it for the
// model to read.
//
// Worktrees are refcounted per (repo, sha) and kept warm for IDLE_MS after the
// last release, so a chat turn right after a run reuses the run's checkout.
// Two servers can share $TANDEM_HOME (the native app and a dev server), so
// removal is decided by the directory's MTIME — touched on every acquire and
// release — rather than by this process's refcount alone.
import { mkdir, readdir, readFile, rm, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isFullSha, type PrRef, type RepoRef } from "../../shared/gh/prKey";
import type { CloneCheck } from "../../shared/settings-types";
import { which } from "../loginPath";
import { enqueueMutation, storagePath } from "../storage/jsonFile";

const IDLE_MS = 15 * 60_000;
/** A worktree untouched this long belongs to no live run in ANY process
 * (a pass times out at 10 minutes). */
const ORPHAN_MS = 2 * 60 * 60_000;
/** Local git work (rev-parse, worktree add) — generous, it is disk-bound. */
const GIT_TIMEOUT_MS = 5 * 60_000;
/** The whole fetch, both attempts together. It is NETWORK-bound and the run
 * is waiting on it, and a checkout that cannot be made degrades to whole
 * files anyway — so a hung link costs 90 seconds, not ten minutes. */
const FETCH_DEADLINE_MS = 90_000;
/** Orphans only exist after a crash, so looking for them once an hour per
 * clone is plenty — not on every acquire, which is every chat turn. */
const SWEEP_EVERY_MS = 60 * 60_000;
/** A file a local read will hand the model; larger ones are skipped, the
 * same way the blob endpoint refuses them. */
const MAX_LOCAL_FILE_BYTES = 1_000_000;

export type Worktree = { path: string; release: () => void };

class CheckoutError extends Error {}

const refs = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastSweep = new Map<string, number>();
// Create/remove are serialized per worktree dir through the shared per-key
// queue (enqueueMutation) — two runs on one sha must not race
// `git worktree add`.

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

let cachedGit: string | null = null;

function gitBin(): string {
  if (!cachedGit) cachedGit = which("git");
  return cachedGit ?? "git";
}

type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

async function git(
  args: string[],
  cwd?: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<GitResult> {
  const proc = Bun.spawn([gitBin(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    // A credential prompt would hang the run forever — fail instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      proc.kill();
    },
    Math.max(1, timeoutMs),
  );
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function lastLine(text: string): string {
  return text.trim().split("\n").filter(Boolean).at(-1) ?? "";
}

/** `github.com/owner/repo` in any remote URL spelling (https, ssh, scp-like). */
export function remoteMatches(url: string, ref: RepoRef): boolean {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    url.trim(),
  );
  return (
    !!m &&
    m[1].toLowerCase() === ref.owner.toLowerCase() &&
    m[2].toLowerCase() === ref.repo.toLowerCase()
  );
}

/**
 * Is `localPath` a git clone of owner/repo? Returns the remote NAME to fetch
 * from. The remote check is what stops a mistyped path from reviewing one
 * repo's PR against another repo's code.
 */
export async function checkClone(
  localPath: string,
  ref: RepoRef,
): Promise<CloneCheck> {
  const dir = expandHome(localPath);
  const exists = await stat(dir).catch(() => null);
  if (!exists?.isDirectory())
    return { ok: false, error: `${localPath} is not a directory` };
  // A clone, a linked worktree of one, or a BARE repo (the usual layout for
  // people who work only in worktrees). A bare repo has no toplevel; every git
  // command used below runs from the bare dir itself just as well.
  const top = await git(["rev-parse", "--show-toplevel"], dir);
  const bare =
    top.code !== 0 &&
    (await git(["rev-parse", "--is-bare-repository"], dir)).stdout.trim() ===
      "true";
  if (top.code !== 0 && !bare)
    return { ok: false, error: `${localPath} is not a git repository` };
  const root = bare ? dir : top.stdout.trim();
  const remotes = await git(["remote", "-v"], dir);
  for (const line of remotes.stdout.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url && remoteMatches(url, ref))
      return { ok: true, root, remote: name };
  }
  return {
    ok: false,
    error: `no remote in ${localPath} points at github.com/${ref.owner}/${ref.repo}`,
  };
}

async function hasCommit(root: string, sha: string): Promise<boolean> {
  return (await git(["cat-file", "-e", `${sha}^{commit}`], root)).code === 0;
}

function worktreesRoot(): string {
  return storagePath("worktrees");
}

function dirFor(ref: PrRef, sha: string): string {
  return join(
    worktreesRoot(),
    `${ref.owner}__${ref.repo}__${sha.slice(0, 12)}`,
  );
}

/** The commit a worktree has checked out, read straight off disk: its `.git`
 * FILE names the admin dir, whose HEAD is the bare sha for a detached
 * checkout. No subprocess — this is the warm path every chat turn takes.
 * Null when `dir` is not a worktree (a crash leftover, or nothing). */
async function worktreeHead(dir: string): Promise<string | null> {
  const pointer = await readFile(join(dir, ".git"), "utf8").catch(() => null);
  const gitdir = /^gitdir:\s*(.+)$/m.exec(pointer ?? "")?.[1]?.trim();
  if (!gitdir) return null;
  const head = await readFile(
    join(isAbsolute(gitdir) ? gitdir : resolve(dir, gitdir), "HEAD"),
    "utf8",
  ).catch(() => null);
  return head?.trim() ?? null;
}

/**
 * One file from a checkout, or null. `path` is repo-relative and is refused
 * outright if it could name anything outside the checkout — the same rule
 * `fetchFileAtRef` applies to the contents API.
 */
export async function readCheckoutFile(
  root: string,
  path: string,
): Promise<string | null> {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  const file = Bun.file(join(root, path));
  if (!(await file.exists()) || file.size > MAX_LOCAL_FILE_BYTES) return null;
  return file.text().catch(() => null);
}

async function touch(dir: string): Promise<void> {
  const now = new Date();
  await utimes(dir, now, now).catch(() => {});
}

/**
 * A read-only checkout of `headSha`, fetching it into the clone first if the
 * clone does not have it yet. Throws CheckoutError with a sentence the run
 * log can show as-is.
 */
export async function acquireWorktree(
  localPath: string,
  ref: PrRef,
  headSha: string,
): Promise<Worktree> {
  if (!isFullSha(headSha))
    throw new CheckoutError(`not a commit sha: ${headSha}`);
  const dir = dirFor(ref, headSha);

  await enqueueMutation(dir, async () => {
    // Reuse a warm one — this process's or a sibling's — before any git runs.
    if ((await worktreeHead(dir)) === headSha) return;

    const clone = await checkClone(localPath, ref);
    if (!clone.ok) throw new CheckoutError(clone.error);
    maybeSweepOrphans(clone.root);

    if (!(await hasCommit(clone.root, headSha))) {
      // `pull/N/head` is the PR's head whatever fork it came from; the bare
      // sha is the fallback for a server that allows fetching one. Both share
      // ONE deadline, and a timeout skips the fallback — a link that hung on
      // the first fetch will hang on the second.
      const deadline = Date.now() + FETCH_DEADLINE_MS;
      const byRef = await git(
        [
          "fetch",
          "--no-tags",
          "--quiet",
          clone.remote,
          `pull/${ref.number}/head`,
        ],
        clone.root,
        FETCH_DEADLINE_MS,
      );
      if (byRef.timedOut)
        throw new CheckoutError(
          `fetching ${headSha.slice(0, 7)} into ${localPath} timed out after ${FETCH_DEADLINE_MS / 1000}s`,
        );
      if (!(await hasCommit(clone.root, headSha))) {
        await git(
          ["fetch", "--no-tags", "--quiet", clone.remote, headSha],
          clone.root,
          deadline - Date.now(),
        );
        if (!(await hasCommit(clone.root, headSha)))
          throw new CheckoutError(
            `could not fetch ${headSha.slice(0, 7)} into ${localPath}: ${lastLine(byRef.stderr) || "commit not found"}`,
          );
      }
    }

    // A directory left by a crash is not a worktree git knows about.
    await rm(dir, { recursive: true, force: true });
    await git(["worktree", "prune"], clone.root);
    await mkdir(worktreesRoot(), { recursive: true, mode: 0o700 });
    const add = await git(
      ["worktree", "add", "--detach", "--force", dir, headSha],
      clone.root,
    );
    if (add.code !== 0)
      throw new CheckoutError(
        `git worktree add failed: ${lastLine(add.stderr)}`,
      );
  });

  const pending = timers.get(dir);
  if (pending) clearTimeout(pending);
  timers.delete(dir);
  refs.set(dir, (refs.get(dir) ?? 0) + 1);
  await touch(dir);

  let released = false;
  return {
    path: dir,
    release: () => {
      if (released) return;
      released = true;
      const left = (refs.get(dir) ?? 1) - 1;
      void touch(dir);
      if (left > 0) {
        refs.set(dir, left);
        return;
      }
      refs.delete(dir);
      timers.set(
        dir,
        setTimeout(() => {
          timers.delete(dir);
          void removeIfIdle(dir, localPath);
        }, IDLE_MS),
      );
    },
  };
}

async function removeIfIdle(dir: string, localPath: string): Promise<void> {
  await enqueueMutation(dir, async () => {
    if (refs.has(dir)) return;
    const info = await stat(dir).catch(() => null);
    if (!info) return;
    // A sibling server touched it since — it is theirs now.
    if (Date.now() - info.mtimeMs < IDLE_MS - 1000) return;
    const root = expandHome(localPath);
    const removed = await git(["worktree", "remove", "--force", dir], root);
    // `worktree remove` drops its own registration; only a hand-deleted dir
    // leaves one behind for prune.
    if (removed.code !== 0) {
      await rm(dir, { recursive: true, force: true });
      await git(["worktree", "prune"], root);
    }
  });
}

function maybeSweepOrphans(cloneRoot: string): void {
  const last = lastSweep.get(cloneRoot) ?? 0;
  if (Date.now() - last < SWEEP_EVERY_MS) return;
  lastSweep.set(cloneRoot, Date.now());
  void sweepOrphans(cloneRoot);
}

/** Remove this clone's Tandem worktrees nobody has touched in ORPHAN_MS —
 * the leftovers of a crash or a server that exited mid-idle. */
async function sweepOrphans(cloneRoot: string): Promise<void> {
  const root = worktreesRoot();
  const names = await readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    const dir = join(root, name);
    if (refs.has(dir)) continue;
    const info = await stat(dir).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < ORPHAN_MS) continue;
    // Fails harmlessly for another clone's worktree — its own sweep gets it.
    await enqueueMutation(dir, () =>
      git(["worktree", "remove", "--force", dir], cloneRoot),
    );
  }
  await git(["worktree", "prune"], cloneRoot);
}
