// Formatting shared by every surface that reports agent work — the pane's
// status card, the header strip, the agent tray. Pure, so the three cannot
// drift into printing the same run three different ways.

/** Compact elapsed/duration: seconds under a minute, then `m ss`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/**
 * What a piece of work cost. A subscription-billed `claude` CLI reports $0 for
 * every pass, so a bare dollar figure would read as "free" — fall back to the
 * token count, which is always real.
 */
export function formatSpend(work: {
  costUsd: number;
  tokensUsed: number;
}): string {
  if (work.costUsd > 0) return `$${work.costUsd.toFixed(2)}`;
  return `${Math.round(work.tokensUsed / 1000)}k tok`;
}

/** `owner/repo#12` → `repo#12`: the strip has ~140px and the owner is the
 * half a reviewer already knows. */
export function shortPrRef(prId: string): string {
  const slash = prId.lastIndexOf("/");
  return slash === -1 ? prId : prId.slice(slash + 1);
}

/** Basenames of the files a step is reading, for a one-line readout. */
export function fileNames(paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) return "";
  return paths.map(fileName).join(" · ");
}

/** One path's basename. The `?? path` matters: `split("/").pop()` is typed
 * `string | undefined`, so an inlined copy renders nothing for a root-level
 * file. */
export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** A commit, as every surface in the app prints one. Seven characters is
 * git's own default abbreviation; the point of having it here is that the run
 * header, the pre-flight card and the thread list cannot print the same commit
 * three different lengths. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
