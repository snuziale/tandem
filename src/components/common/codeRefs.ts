// `path.ts:42` in agent prose, turned into something you can click.
//
// The agent is told to cite file:line whenever it makes a claim about the
// code, and it does — but as inert text, so the reader had to find the file in
// the tree and scroll to the line themselves. That is the whole gap between a
// panel that answers and one that drives: the cheapest way to make the agent
// feel like it is moving through the review with you is to let it move your
// viewport.
//
// Pure, and tested, because everything downstream of it is a DOM walk: the
// rehype plugin (mdCodeRefs.tsx) splits text nodes on these offsets, and the
// resolver runs against the PR's real file list.

/** One `path:line` (or `path:start-end`) found in prose. */
export type CodeRef = {
  /** Exactly as written — a basename is common and is resolved later. */
  path: string;
  /** The line the reference names. A range's END, matching every other anchor
   * in the app; `startLine` carries the other half. */
  line: number;
  startLine?: number;
};

export type CodeRefMatch = {
  /** Offsets into the scanned string. */
  start: number;
  end: number;
  /** The matched text, so a caller can render it verbatim. */
  text: string;
  ref: CodeRef;
};

/**
 * A path-looking token followed by `:line` or `:line-line`.
 *
 * The extension is required, and that is what keeps this from firing on
 * ordinary prose: `severity:3` and `10:30` are not references, while
 * `src/shared/gh/patch.ts:212` and `patch.ts:212-224` are. A trailing `)` or
 * `.` is left out of the match so a reference at the end of a sentence does
 * not swallow the punctuation.
 */
const REF =
  /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]{0,9}:\d{1,6}(?:-\d{1,6})?/g;

/** A ref must not be preceded by a character that makes it part of a longer
 * token — a URL (`//host/a.ts:1`) or an identifier. */
function boundaryOk(text: string, at: number): boolean {
  if (at === 0) return true;
  return !/[A-Za-z0-9_/@:-]/.test(text[at - 1]);
}

export function findCodeRefs(text: string): CodeRefMatch[] {
  const out: CodeRefMatch[] = [];
  REF.lastIndex = 0;
  for (let m = REF.exec(text); m !== null; m = REF.exec(text)) {
    if (!boundaryOk(text, m.index)) continue;
    const raw = m[0];
    const colon = raw.lastIndexOf(":");
    const path = raw.slice(0, colon);
    const [first, second] = raw
      .slice(colon + 1)
      .split("-")
      .map(Number);
    // `a.ts:40-20` is not a range anyone meant; take the anchor and move on.
    const line = second === undefined ? first : Math.max(first, second);
    const startLine =
      second === undefined || Math.min(first, second) === line
        ? undefined
        : Math.min(first, second);
    if (!Number.isInteger(line) || line < 1) continue;
    out.push({
      start: m.index,
      end: m.index + raw.length,
      text: raw,
      ref: { path, line, startLine },
    });
  }
  return out;
}

/**
 * The real file a reference names. The agent writes a basename as often as a
 * full path, so a suffix match on a path SEGMENT boundary is the rule —
 * `patch.ts` finds `src/shared/gh/patch.ts`, and never `src/gh/mypatch.ts`.
 *
 * Ambiguity resolves to nothing rather than to a guess: two files called
 * `index.ts` are exactly the case where jumping to the wrong one is worse than
 * not jumping at all.
 */
export function resolveCodeRef(
  ref: CodeRef,
  paths: readonly string[],
): string | null {
  if (paths.includes(ref.path)) return ref.path;
  const suffix = ref.path.startsWith("/") ? ref.path : `/${ref.path}`;
  const hits = paths.filter((p) => p.endsWith(suffix));
  return hits.length === 1 ? hits[0] : null;
}
