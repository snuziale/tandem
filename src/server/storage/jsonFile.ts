// Shared durability mechanics for the small files Tandem keeps under
// `$TANDEM_HOME ?? ~/.tandem`: reviews.json, runs.json, views.json,
// settings.json.
//
// Text in, text out. Callers own their own parsing, validation and caching.
// The only thing shared here is durability: one mutation queue per file,
// atomic temp-file + rename replace, 0600 on everything written.
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { IS_WINDOWS } from "../platform";

// One chain per file path, NOT one global chain — two unrelated stores must not
// serialize against each other. Keys are the handful of files listed above (plus
// one temp home per test), so the map stays small.
const queues = new Map<string, Promise<void>>();

/** The directory every file below lives in. Resolved per call, so a
 * `$TANDEM_HOME` change takes effect — and exported because About tells the
 * user where their data is, which must be this answer and not a guess. */
export function storageHome(): string {
  return process.env.TANDEM_HOME ?? join(homedir(), ".tandem");
}

/** Path of a file in the storage dir. Resolved per call, so a `$TANDEM_HOME` change takes effect. */
export function storagePath(name: string): string {
  return join(storageHome(), name);
}

/**
 * Run `operation` after every mutation already queued for `file`, so concurrent
 * writers can't interleave a read-modify-write. Calling this from inside an
 * operation for the same file would deadlock — reads that must not observe a
 * half-applied state await {@link pendingWrites} instead.
 */
export function enqueueMutation<T>(
  file: string,
  operation: () => Promise<T>,
): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).then(operation);
  // The queue holds the swallowed form: one failed mutation must not reject
  // every later one, but the caller still sees its own rejection.
  queues.set(
    file,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Resolves once the mutations queued for `file` have settled. */
export function pendingWrites(file: string): Promise<void> {
  return queues.get(file) ?? Promise.resolve();
}

/** File contents, or null when the file does not exist. Not queue-aware. */
export async function readTextFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

/**
 * Atomic replace: write a unique temp file, then rename it over `file`, so a
 * concurrent reader sees either the old contents or the new ones — never a
 * partial write. Not queue-aware; wrap it in {@link enqueueMutation}.
 */
export async function writeTextFile(
  file: string,
  contents: string,
): Promise<void> {
  const dir = dirname(file);
  const temp = join(
    dir,
    `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(dir, { recursive: true, mode: 0o700 });
  let renamed = false;
  try {
    await writeFile(temp, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    // Chmod before the rename: this is the inode that becomes `file`, so there
    // is no window where the final path exists with a wider mode.
    await setPrivatePermissions(temp);
    await renameOverwriting(temp, file);
    renamed = true;
  } finally {
    // Only on the failure path — a successful rename moved the temp inode onto
    // `file`, so the unlink would find nothing.
    if (!renamed) await rm(temp, { force: true });
  }
}

// POSIX rename replaces the target atomically even while another process holds
// it open, so there it is a plain call. Windows has no such guarantee:
// `ReplaceFile` fails with EPERM/EACCES (and EBUSY on a directory handle) when a
// reader is mid-read — a real case here, since two servers can share one
// `$TANDEM_HOME` (see agent/runsIndex.ts) and every poll reads the same handful
// of files. The window is one read of a small JSON file, so a few short retries
// close it.
const RENAME_RETRIES = 10;
const RENAME_BACKOFF_MS = 20;

async function renameOverwriting(from: string, to: string): Promise<void> {
  if (!IS_WINDOWS) return rename(from, to);
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      // The three Windows spellings of "someone else has this file open".
      if (
        attempt >= RENAME_RETRIES ||
        !hasErrorCode(error, "EPERM", "EACCES", "EBUSY")
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFF_MS));
    }
  }
}

async function setPrivatePermissions(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows ACLs do not map cleanly to POSIX modes — chmod is a no-op there,
    // so these files inherit the user profile's ACL instead of being 0600.
    // Settings › About says so rather than repeating the POSIX claim.
  }
}

/** Whether a thrown value is a Node errno error carrying one of `codes`. */
function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return codes.includes(error.code as string);
}
