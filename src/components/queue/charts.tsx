// Chart primitives for the queue stats drawer. Deliberately hand-rolled divs,
// not a chart library: every form here is a proportional bar, the drawer is
// dense, and the marks have to sit on the app's own tokens in both themes.
//
// Conventions these enforce (they are the reason this file exists):
//  - Every value is VISIBLE as text beside its mark. No value is reachable
//    only by hovering, so the charts are their own table view.
//  - Bars are thin (10px), grow from a single baseline, and carry a 4px
//    rounded data-end with a square baseline end.
//  - Stacked segments are separated by a 2px SURFACE GAP, never a border.
//  - Selection emphasises: the picked mark keeps full color, the rest recede.
//    Color never encodes rank, so filtering can't repaint anything.
//  - Text wears text tokens; the colored mark beside it carries identity.
import { cn } from "@uipath/apollo-wind";
import type { Slice } from "../../utils/queueStats";

/** One card in the drawer grid. `hint` is the subtitle, not a legend. */
export function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          {title}
        </h3>
        {hint ? (
          <span className="text-[10px] text-muted-foreground/70 truncate">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

type BarListProps = {
  slices: Slice[];
  /** Denominator for the SHARE quoted in the tooltip — always the view total. */
  total: number;
  /**
   * Denominator for bar LENGTH. Ordinal cards pass the view total (their
   * buckets partition it, so the bars should sum to the full width); nominal
   * top-N lists pass their own largest slice, or six authors out of fifty
   * render as six near-empty tracks.
   */
  scale: number;
  /** Mark color per slice index. One color for nominal, a ramp for ordinal. */
  colorAt: (index: number) => string;
  /** Key of the slice the active facet selects, if any. */
  activeKey?: string | null;
  /** Something is selected somewhere — unselected marks recede. */
  dimmed?: boolean;
  onSelect: (slice: Slice) => void;
  /** "+4 more authors" under the last bar. */
  footnote?: string;
};

export function BarList({
  slices,
  total,
  scale,
  colorAt,
  activeKey,
  dimmed,
  onSelect,
  footnote,
}: BarListProps) {
  if (slices.length === 0)
    return <p className="text-xs text-muted-foreground/70">—</p>;
  return (
    <div className="flex flex-col gap-1">
      {slices.map((slice, i) => {
        const pct = scale > 0 ? (slice.value / scale) * 100 : 0;
        const share = total > 0 ? Math.round((slice.value / total) * 100) : 0;
        const active = activeKey === slice.key;
        return (
          <button
            key={slice.key}
            type="button"
            onClick={() => onSelect(slice)}
            aria-pressed={active}
            title={`${slice.label} — ${slice.value} of ${total} (${share}%) · click to filter`}
            className={cn(
              "group grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.25rem] items-center gap-2",
              "rounded-sm px-1 -mx-1 py-0.5 text-left cursor-pointer",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active && "bg-accent",
            )}
          >
            <span
              className={cn(
                "text-xs truncate",
                active ? "text-foreground font-medium" : "text-foreground/80",
              )}
            >
              {slice.label}
            </span>
            {/* Track is a hairline wash, not a second data mark — it exists so
                the whole row is a comfortable click target. */}
            <span className="relative h-2.5 rounded-[2px] bg-foreground/[0.06] overflow-hidden">
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-200",
                  dimmed && !active && "opacity-40",
                )}
                style={{
                  // A count of 1 in a 200-PR view is still a real row: floor a
                  // non-zero mark at 3px so it never renders as nothing. Zero
                  // gets NO mark — a floored zero would be a lie, and empty
                  // ordinal buckets are kept precisely so the gap shows.
                  width: slice.value === 0 ? 0 : `max(3px, ${pct}%)`,
                  background: colorAt(i),
                }}
              />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground text-right">
              {slice.value}
            </span>
          </button>
        );
      })}
      {footnote ? (
        <p className="text-[10px] text-muted-foreground/70 pl-1 pt-0.5">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

type StatusStripProps = {
  slices: Slice[];
  total: number;
  colorOf: (key: string) => string;
  labelOf: (key: string) => string;
  activeKey?: string | null;
  dimmed?: boolean;
  onSelect: (slice: Slice) => void;
};

/**
 * A single stacked bar plus its legend. Interior segments get no inline label
 * (they'd clip) — the legend under the strip carries name and count, which is
 * also what makes the identity channel more than color.
 */
export function StatusStrip({
  slices,
  total,
  colorOf,
  labelOf,
  activeKey,
  dimmed,
  onSelect,
}: StatusStripProps) {
  if (slices.length === 0)
    return <p className="text-xs text-muted-foreground/70">—</p>;
  return (
    <div className="flex flex-col gap-2">
      {/* gap-[2px] IS the separator — the surface shows through between fills. */}
      <div className="flex gap-[2px] h-2.5 max-w-[30rem]">
        {slices.map((slice) => {
          const active = activeKey === slice.key;
          return (
            <button
              key={slice.key}
              type="button"
              onClick={() => onSelect(slice)}
              aria-pressed={active}
              aria-label={`${labelOf(slice.key)}: ${slice.value}`}
              title={`${labelOf(slice.key)} — ${slice.value} of ${total} · click to filter`}
              style={{
                flexGrow: slice.value,
                background: colorOf(slice.key),
              }}
              className={cn(
                "min-w-[3px] rounded-[2px] cursor-pointer transition-opacity",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
                dimmed && !active ? "opacity-40" : "hover:opacity-80",
              )}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {slices.map((slice) => {
          const active = activeKey === slice.key;
          return (
            <button
              key={slice.key}
              type="button"
              onClick={() => onSelect(slice)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-1.5 text-xs rounded-sm px-1 -mx-1 cursor-pointer",
                "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active && "bg-accent",
              )}
            >
              <span
                className={cn(
                  "inline-block w-2 h-2 rounded-[2px] shrink-0",
                  dimmed && !active && "opacity-40",
                )}
                style={{ background: colorOf(slice.key) }}
              />
              <span
                className={
                  active ? "text-foreground font-medium" : "text-foreground/80"
                }
              >
                {labelOf(slice.key)}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {slice.value}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Stat tile: label + value, optionally a facet link. `tone` is a STATUS
 * signal (a failing-checks count is bad news) — it colors the value and is
 * always paired with the written label, never carrying meaning alone.
 */
export function StatTile({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "danger" | "warning";
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border border-border/60 px-3 py-2 text-left min-w-0",
        onClick &&
          "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active && "bg-accent border-border",
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono truncate max-w-full">
        {label}
      </span>
      <span
        className={cn(
          // Proportional figures: these are standalone display numbers, not a
          // column that has to align.
          "text-xl font-semibold leading-none",
          tone === "danger" && "text-red-500 dark:text-red-400",
          tone === "warning" && "text-yellow-600 dark:text-yellow-400",
        )}
      >
        {value}
      </span>
      {sub ? (
        <span className="text-[10px] text-muted-foreground truncate max-w-full">
          {sub}
        </span>
      ) : null}
    </Tag>
  );
}
