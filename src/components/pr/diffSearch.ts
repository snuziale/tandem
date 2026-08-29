// Find-in-diff: the pure half. Everything here reads PATCH TEXT, never the
// DOM, and that is the whole reason the feature exists — CodeView is
// virtualized and a folded file renders no code at all, so the browser's own
// find can only ever see the render window. The patches, by contrast, are in
// memory for every file whatever is scrolled, folded or marked viewed.
//
// Two limits are deliberate and must stay visible in the UI that reads this:
// only lines the PATCH contains are searched (expanded context came from the
// blob, so it is absent by construction), and the caller passes the patch the
// pane is CURRENTLY rendering — the hide-whitespace rewrite when `w` is on —
// or the count would disagree with the screen.
import { patchBodyLines } from "../../shared/gh/patch";
import type { DiffSide } from "../../shared/review-types";

export type DiffSearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Only lines this PR ADDED — the "is the old helper still used anywhere?"
   * question, which is the one a reviewer actually asks. */
  additionsOnly: boolean;
};

export const DEFAULT_SEARCH_OPTIONS: DiffSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  additionsOnly: false,
};

export type DiffHit = {
  path: string;
  /** Which side's numbering `line` is in. A deletion reads LEFT; an addition
   * and a context line both read RIGHT, which is the side the pane anchors
   * everything else to. */
  side: DiffSide;
  line: number;
  kind: "ctx" | "del" | "add";
  /** 0-based offset of the match inside `text`. */
  column: number;
  length: number;
  /** The whole line, patch prefix stripped — the preview's source. */
  text: string;
};

/**
 * Where the scan stops. Past a few hundred the count has stopped being a
 * number anyone reads and the list has stopped being a list, so cutting it
 * short and SAYING SO beats spending the frame.
 */
export const MAX_HITS = 500;

export type DiffSearchResult = {
  hits: DiffHit[];
  /** True when MAX_HITS cut the scan short — the count is a floor, not a total. */
  truncated: boolean;
  /** Set only in regex mode, when the pattern itself will not compile. */
  error: string | null;
};

export const EMPTY_SEARCH_RESULT: DiffSearchResult = {
  hits: [],
  truncated: false,
  error: null,
};

/** A compiled pattern. Separate from the walk so the walk stays a walk. */
export type Matcher = {
  find: (text: string) => { index: number; length: number }[];
};

const escapeRegExp = (term: string) =>
  term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compile a term into something that can be run against a line. Null for an
 * empty term (nothing to search, not an error); a string for a regex the user
 * is still halfway through typing, which the bar prints instead of pretending
 * there are no matches.
 */
export function compileMatcher(
  term: string,
  options: DiffSearchOptions,
): Matcher | string | null {
  if (term === "") return null;
  const body = options.regex ? `(?:${term})` : escapeRegExp(term);
  const source = options.wholeWord ? `\\b${body}\\b` : body;
  let re: RegExp;
  try {
    re = new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch (err) {
    return err instanceof Error ? err.message : "invalid pattern";
  }
  return {
    find: (text) => {
      const out: { index: number; length: number }[] = [];
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        // A zero-length match (`a*`, `^`) would loop forever and marks nothing
        // on screen. Step past it rather than reporting it.
        if (match[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        out.push({ index: match.index, length: match[0].length });
      }
      return out;
    },
  };
}

/**
 * Every match of `term` across the diff, in the order a reader would walk it:
 * file order first (the order the pane lays the files out), then patch order
 * within a file. That ordering is what makes next/previous predictable — a
 * ranked or grouped list would step you around the pane at random.
 */
export function searchDiff(
  files: readonly { path: string; patch: string }[],
  term: string,
  options: DiffSearchOptions,
): DiffSearchResult {
  const matcher = compileMatcher(term, options);
  if (matcher === null) return EMPTY_SEARCH_RESULT;
  if (typeof matcher === "string")
    return { hits: [], truncated: false, error: matcher };

  const hits: DiffHit[] = [];
  for (const file of files) {
    for (const line of patchBodyLines(file.patch)) {
      if (options.additionsOnly && line.kind !== "add") continue;
      for (const match of matcher.find(line.text)) {
        hits.push({
          path: file.path,
          side: line.kind === "del" ? "LEFT" : "RIGHT",
          line: line.kind === "del" ? line.oldNo : line.newNo,
          kind: line.kind,
          column: match.index,
          length: match.length,
          text: line.text,
        });
        if (hits.length >= MAX_HITS)
          return { hits, truncated: true, error: null };
      }
    }
  }
  return { hits, truncated: false, error: null };
}

export type HitGroup = {
  path: string;
  /** Position of this group's first hit in the flat walk. */
  first: number;
  hits: DiffHit[];
};

/**
 * Hits grouped by file for the results list, files in hit order.
 *
 * A file's hits are CONTIGUOUS in that walk — files first, then patch order
 * inside one — so one `first` index maps every row back to its position, and
 * the list never has to search the flat array to find out where a click goes.
 */
export function groupHits(hits: readonly DiffHit[]): HitGroup[] {
  const out: HitGroup[] = [];
  hits.forEach((hit, index) => {
    const last = out[out.length - 1];
    if (last && last.path === hit.path) last.hits.push(hit);
    else out.push({ path: hit.path, first: index, hits: [hit] });
  });
  return out;
}

/**
 * Wrap next/previous around the hit list. `current` is -1 when nothing is
 * selected yet, which is the state the bar sits in until the reader asks to
 * jump: forward starts at the first hit, backward at the last.
 */
export function stepHit(count: number, current: number, delta: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export type HitPreview = { before: string; match: string; after: string };

/**
 * One line of a hit, clipped to `maxLength` around the match and split so the
 * match itself can be marked. Split rather than pre-marked because the
 * highlight is a React element in OUR DOM — the results list never touches the
 * pane's shadow tree.
 *
 * Leading indentation is dropped: in a one-line preview it is pure noise. Not
 * when the match is INSIDE it, though — searching for whitespace is the one
 * case where the indentation is the answer.
 */
export function previewOf(hit: DiffHit, maxLength = 120): HitPreview {
  const indent = /^[ \t]*/.exec(hit.text)?.[0].length ?? 0;
  const dropped = hit.column >= indent ? indent : 0;
  const text = hit.text.slice(dropped);
  const column = hit.column - dropped;
  const match = text.slice(column, column + hit.length);
  const before = text.slice(0, column);
  const after = text.slice(column + hit.length);

  const room = maxLength - match.length;
  if (room <= 0)
    return { before: "", match: match.slice(0, maxLength), after: "" };
  // The match is what you came for and code reads left to right, so the
  // leading side gets the smaller share of the budget and gives back whatever
  // the trailing side could not use.
  const keepAfter = Math.min(after.length, room - Math.floor(room * 0.4));
  const keepBefore = Math.min(before.length, room - keepAfter);
  return {
    before:
      (keepBefore < before.length ? "…" : "") +
      before.slice(before.length - keepBefore),
    match,
    after: after.slice(0, keepAfter) + (keepAfter < after.length ? "…" : ""),
  };
}
