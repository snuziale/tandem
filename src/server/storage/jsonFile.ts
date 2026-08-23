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

// One chain per file path, NOT one global chain — two unrelated stores must not
// serialize against each other. Keys are the handful of files listed above (plus
// one temp home per test), so the map stays small.
const queues = new Map<string, Promise<void>>();

function storageDir(): string {
  return process.env.TANDEM_HOME ?? join(homedir(), ".tandem");
}

/** Path of a file in the storage dir. Resolved per call, so a `$TANDEM_HOME` change takes effect. */
export function storagePath(name: string): string {
  return join(storageDir(), name);
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
    if (isMissingFile(error)) return null;
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
    await rename(temp, file);
    renamed = true;
  } finally {
    // Only on the failure path — a successful rename moved the temp inode onto
    // `file`, so the unlink would find nothing.
    if (!renamed) await rm(temp, { force: true });
  }
}

async function setPrivatePermissions(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows ACLs do not map cleanly to POSIX modes.
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
