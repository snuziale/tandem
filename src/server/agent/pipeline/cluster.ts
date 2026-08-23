// Pass-2 file clustering: related files analyzed together so cross-file
// context survives (a hook and its test, a type and its consumer), while
// keeping each invocation's prompt bounded.
import type { FileChange } from "../../../shared/review-types";

const MAX_FILES_PER_CLUSTER = 8;
const MAX_LINES_PER_CLUSTER = 800;

/** Files the agent should read: has a patch, not generated. */
export function analyzableFiles(files: FileChange[]): FileChange[] {
  return files.filter(
    (f) => f.patch !== undefined && !f.isGenerated && !f.isBinary,
  );
}

/**
 * Group by top-level directory (tests usually live beside their subjects), then
 * split any group exceeding the per-invocation caps.
 */
export function clusterFiles(files: FileChange[]): FileChange[][] {
  const groups = new Map<string, FileChange[]>();
  for (const file of files) {
    const key = topDir(file.path);
    const list = groups.get(key) ?? [];
    list.push(file);
    groups.set(key, list);
  }

  const clusters: FileChange[][] = [];
  for (const group of groups.values()) {
    let current: FileChange[] = [];
    let lines = 0;
    for (const file of group) {
      const fileLines = file.additions + file.deletions;
      if (
        current.length > 0 &&
        (current.length >= MAX_FILES_PER_CLUSTER ||
          lines + fileLines > MAX_LINES_PER_CLUSTER)
      ) {
        clusters.push(current);
        current = [];
        lines = 0;
      }
      current.push(file);
      lines += fileLines;
    }
    if (current.length) clusters.push(current);
  }
  return clusters;
}

function topDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}
