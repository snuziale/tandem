import { groupHits, previewOf, type DiffHit } from "./diffSearch";

type Props = {
  hits: readonly DiffHit[];
  activeIndex: number;
  onJump: (index: number) => void;
  /** MAX_HITS cut the scan short — the count above is a floor. */
  truncated: boolean;
  /** `w` is on, so whitespace-only changes are folded out of what was scanned. */
  hideWhitespace: boolean;
};

// The +/− the diff itself paints — the same pair `DiffFileHeader` prints beside
// a file name. Classes, not the inline hex the FileTree uses: that one is a
// `color` VALUE handed to the tree library's decoration API, and this is our
// own DOM, which Tailwind reaches.
const MARKER: Record<DiffHit["kind"], { glyph: string; className: string }> = {
  add: { glyph: "+", className: "text-emerald-500" },
  del: { glyph: "−", className: "text-red-400" },
  ctx: { glyph: " ", className: "" },
};

/**
 * One hit. Its own component so that stepping `n` re-renders the row leaving
 * `active` and the row taking it, not all five hundred — `previewOf` runs per
 * row, and the list is not virtualized.
 */
function HitRow({
  hit,
  index,
  active,
  onJump,
}: {
  hit: DiffHit;
  index: number;
  active: boolean;
  onJump: (index: number) => void;
}) {
  const preview = previewOf(hit);
  const marker = MARKER[hit.kind];
  return (
    <button
      type="button"
      onClick={() => onJump(index)}
      className={`w-full flex items-baseline gap-2 px-2 py-0.5 text-left font-mono text-[11px] hover:bg-accent ${
        active ? "bg-accent" : ""
      }`}
    >
      <span
        className={`w-3 shrink-0 tabular-nums ${marker.className}`}
        aria-hidden
      >
        {marker.glyph}
      </span>
      <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
        {hit.line}
      </span>
      <span className="truncate whitespace-pre">
        {preview.before}
        <span className="bg-foreground/15 text-foreground rounded-[2px]">
          {preview.match}
        </span>
        {preview.after}
      </span>
    </button>
  );
}

/**
 * Every hit, grouped by file — the half of find-in-diff that actually answers
 * the complaint the browser's find could not. A file folded, marked viewed or
 * fifty screens down still shows its count here, so a match is never something
 * you have to already be looking at to know about.
 *
 * The match is marked with a React element over OUR text. The pane's own code
 * lives in a shadow tree the library owns and re-tokenizes as it virtualizes;
 * nothing here reaches into it.
 */
export function DiffSearchResults({
  hits,
  activeIndex,
  onJump,
  truncated,
  hideWhitespace,
}: Props) {
  const groups = groupHits(hits);
  return (
    <div className="max-h-[45vh] overflow-y-auto border-t border-border">
      {groups.map((group) => (
        <div key={group.path}>
          <div className="flex items-baseline gap-2 px-2 py-1 bg-muted/40 sticky top-0">
            <span className="text-[11px] font-mono truncate" title={group.path}>
              {group.path}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums ml-auto shrink-0">
              {group.hits.length}
            </span>
          </div>
          {group.hits.map((hit, i) => {
            const index = group.first + i;
            return (
              <HitRow
                key={index}
                hit={hit}
                index={index}
                active={index === activeIndex}
                onJump={onJump}
              />
            );
          })}
        </div>
      ))}
      {/* What was NOT searched, said out loud — both of these are why a count
          here can be smaller than a count on github.com. */}
      {truncated || hideWhitespace ? (
        <div className="px-2 py-1 text-[10px] text-muted-foreground border-t border-border">
          {truncated
            ? "First matches only — narrow the term for the rest. "
            : ""}
          {hideWhitespace
            ? "Whitespace-only changes are hidden, so unsearched."
            : ""}
        </div>
      ) : null}
    </div>
  );
}
