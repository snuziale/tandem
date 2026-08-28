// The queue's stats drawer: a breakdown of the ACTIVE VIEW, where every mark
// is also a filter. Snapshot only — the queue payload is the set of currently
// open PRs, so these are distributions, never trends over time.
//
// Two deliberate choices:
//  - Charts are computed from the UNFILTERED rows and stay put when a facet is
//    picked; only the table below narrows. A chart that collapsed onto its own
//    selection couldn't be used to choose the next slice.
//  - Selection reads as EMPHASIS (picked mark keeps its color, the rest recede)
//    rather than recolor, so a hue never means "currently selected".
import { useMemo } from "react";
import { Button, cn } from "@uipath/apollo-wind";
import { Info, X } from "lucide-react";
import { usePulseHistory } from "../../hooks/usePulse";
import {
  PULSE_HEADLINE_STATES,
  PULSE_LABELS,
  type PulseOptions,
} from "../../shared/pulse";
import { PULSE_COLOR } from "./pulseIcons";
import type { PullRequest } from "../../shared/review-types";
import {
  computeQueueStats,
  NOMINAL_LIMIT,
  facetLabel,
  sameFacet,
  type Facet,
  type FacetDim,
  type Slice,
} from "../../utils/queueStats";
import {
  BarList,
  ChartCard,
  Sparklines,
  StatTile,
  StatusStrip,
} from "./charts";

/** One flat hue for nominal bars: author and repo are one series each, and
 * bar length already encodes the value — a ramp there would double-encode it. */
const NOMINAL = "var(--tandem-bar)";
/** Ordered dimensions read their order in the color (tokens in index.css). */
const RAMP = [
  "var(--tandem-ramp-1)",
  "var(--tandem-ramp-2)",
  "var(--tandem-ramp-3)",
  "var(--tandem-ramp-4)",
];

// Status, not identity: these are the design system's reserved status tokens,
// theme-aware, and each segment always ships with its written label + count.
const STATUS: Record<string, string> = {
  passing: "var(--success)",
  pending: "var(--warning)",
  failing: "var(--error)",
  none: "var(--foreground-muted)",
  approved: "var(--success)",
  awaiting: "var(--warning)",
  changes: "var(--error)",
  draft: "var(--foreground-muted)",
  // Pulse wears the same reserved status tokens everywhere, from the ONE table
  // in pulseIcons.ts — with a single deliberate override below.
  ...PULSE_COLOR,
  // `moving` alone differs here, and only here: elsewhere it is a text label
  // the eye should slide off, but a chart segment painted `--foreground-muted`
  // reads as absent rather than neutral, so it takes the neutral DATA hue.
  moving: "var(--tandem-bar)",
};

const CHECK_LABELS: Record<string, string> = {
  passing: "passing",
  pending: "pending",
  failing: "failing",
  none: "no checks",
};

const REVIEW_LABELS: Record<string, string> = {
  awaiting: "awaiting you",
  changes: "changes requested",
  approved: "approved",
  draft: "draft",
  none: "no review",
};

type Props = {
  /** The whole view, before the facet — the charts' denominator. */
  rows: PullRequest[] | undefined;
  /** Identity of the view being described — the series key of the daily
   * rollup. Null while the view list is still resolving. */
  viewId: string | null;
  /** Viewer + staleness line — the pulse dimension is the one that needs more
   * than the row itself, and everything on screen must use the same values. */
  pulseOpts: PulseOptions;
  /** How many rows survive the active facet (what the table below shows). */
  shownCount: number;
  /**
   * GitHub's `issueCount` for the view — the TRUE total, which can exceed the
   * page we loaded. The drawer only ever describes the rows it has, so when
   * these differ it has to say so; a breakdown reads as a claim about the whole
   * view, and silently describing a slice of it is the lie this guards against.
   */
  matching: number | undefined;
  now: number;
  facet: Facet | null;
  onFacet: (facet: Facet | null) => void;
};

export function StatsDrawer({
  rows,
  viewId,
  pulseOpts,
  shownCount,
  matching,
  now,
  facet,
  onFacet,
}: Props) {
  const stats = useMemo(
    () => computeQueueStats(rows ?? [], now, pulseOpts),
    [rows, now, pulseOpts],
  );
  // The ONLY trend in this drawer, and it comes from the daily rollup on disk
  // rather than the rows — see shared/pulse-journal.ts for why that boundary
  // is drawn where it is.
  const trend = usePulseHistory(viewId, 30).data ?? [];

  /** Clicking the selected mark again clears the filter. */
  const pick = (dim: FacetDim) => (slice: Slice) => {
    const next: Facet = { dim, value: slice.key };
    onFacet(sameFacet(facet, next) ? null : next);
  };
  const toggle = (next: Facet) => () =>
    onFacet(sameFacet(facet, next) ? null : next);
  const keyFor = (dim: FacetDim) => (facet?.dim === dim ? facet.value : null);
  const dimmed = facet !== null;
  const truncated = matching !== undefined && matching > stats.total;

  if (!rows) {
    return (
      <Shell>
        <p className="text-xs text-muted-foreground">Loading the view…</p>
      </Shell>
    );
  }
  if (rows.length === 0) {
    return (
      <Shell>
        <p className="text-xs text-muted-foreground">
          Nothing to break down — this view matched no open PRs.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* The headline row is the pulse, not the raw buckets: "3 blocked on
            you" is a thing to do, "12 awaiting review" is a thing to read. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <StatTile
            label="open PRs"
            value={stats.total}
            sub={
              truncated
                ? `of ${matching} matching`
                : `${compact(stats.totalChurn)} lines waiting`
            }
          />
          <StatTile
            label="blocked on you"
            value={stats.blockedOnYou}
            sub="your review is the hold-up"
            tone={stats.blockedOnYou > 0 ? "warning" : undefined}
            active={sameFacet(facet, { dim: "pulse", value: "blocked-on-you" })}
            onClick={toggle({ dim: "pulse", value: "blocked-on-you" })}
          />
          <StatTile
            label="rotting"
            value={stats.rotting}
            sub={`untouched ${pulseOpts.rottingDays ?? 7}d+`}
            tone={stats.rotting > 0 ? "danger" : undefined}
            active={sameFacet(facet, { dim: "pulse", value: "rotting" })}
            onClick={toggle({ dim: "pulse", value: "rotting" })}
          />
          <StatTile
            label="ready to merge"
            value={stats.readyToMerge}
            sub="approved and green"
            active={sameFacet(facet, { dim: "pulse", value: "ready" })}
            onClick={toggle({ dim: "pulse", value: "ready" })}
          />
          <StatTile
            label="failing"
            value={stats.failing}
            sub="checks red"
            tone={stats.failing > 0 ? "danger" : undefined}
            active={sameFacet(facet, { dim: "checks", value: "failing" })}
            onClick={toggle({ dim: "checks", value: "failing" })}
          />
        </div>

        {facet ? (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              showing{" "}
              <span className="text-foreground font-medium tabular-nums">
                {shownCount}
              </span>{" "}
              of {stats.total}
            </span>
            <Button
              size="2xs"
              variant="outline"
              onClick={() => onFacet(null)}
              className="font-mono text-[11px]"
            >
              {facetLabel(facet)}
              <X />
            </Button>
          </div>
        ) : null}
      </div>

      {truncated ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground -mt-1">
          <Info className="size-3 shrink-0" />
          This view matches {matching} PRs; GitHub returns one page. Everything
          below describes the {stats.total} most recently updated — not the
          whole view.
        </p>
      ) : null}

      {/* TWO BANDS, each with ONE wrapping rule — the drawer used to be a
          single 4-column grid where some cards spanned two, which meant a
          card was full-width at one breakpoint and half-width at the next and
          the reflow read as arbitrary. Now: strips (a proportional bar plus a
          legend, which needs width) go two-up; distributions (short bar
          lists, all the same shape) go four-up. Nothing spans.

          Now that the cards are BOXED, an empty cell is a visible void rather
          than harmless whitespace — so the strip band takes its column count
          from how many cards it actually has: three strips go three-up and
          fill one row, and the fourth (trend) drops them to a full 2x2. Both
          land flush. The distribution band below always has four slots and
          only ever sheds from the front, so its gap is trailing. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          trend.length >= 2 ? "lg:grid-cols-2" : "lg:grid-cols-3",
        )}
      >
        <ChartCard title="pulse">
          <StatusStrip
            slices={stats.pulse}
            total={stats.total}
            colorOf={(k) => STATUS[k]}
            labelOf={(k) => PULSE_LABELS[k as keyof typeof PULSE_LABELS] ?? k}
            activeKey={keyFor("pulse")}
            dimmed={dimmed}
            onSelect={pick("pulse")}
          />
          {/* Only the FAILURE case says anything. Every segment is already
              labelled, so a subtitle restating what the card is would be
              decoration — but "nothing can be attributed to you" changes how
              every number above should be read. */}
          {pulseOpts.viewerLogin ? null : (
            <p className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-1.5">
              No login resolved — nothing can be attributed to you, so "blocked
              on you" stays empty.
            </p>
          )}
        </ChartCard>

        {/* Only once there are two points to join. A card that says "not
            enough history yet" is a promise, not a chart, and it would sit
            here taking a slot for the whole first day of use. */}
        {trend.length >= 2 ? (
          <ChartCard
            title="pulse over time"
            hint={`${trend.length} days recorded`}
          >
            <Sparklines
              days={trend.map((row) => row.day)}
              /* Three lines, not five: a five-line sparkline at 28px is a
                 scribble, and these are the three the header pill promotes
                 for the same reason. */
              series={PULSE_HEADLINE_STATES.map((key) => ({
                key,
                label: PULSE_LABELS[key],
                color: STATUS[key],
                values: trend.map((row) => row.counts[key]),
              }))}
            />
          </ChartCard>
        ) : null}

        <ChartCard title="checks">
          <StatusStrip
            slices={stats.checks}
            total={stats.total}
            colorOf={(k) => STATUS[k]}
            labelOf={(k) => CHECK_LABELS[k] ?? k}
            activeKey={keyFor("checks")}
            dimmed={dimmed}
            onSelect={pick("checks")}
          />
        </ChartCard>

        <ChartCard title="review state">
          <StatusStrip
            slices={stats.review}
            total={stats.total}
            colorOf={(k) => STATUS[k]}
            labelOf={(k) => REVIEW_LABELS[k] ?? k}
            activeKey={keyFor("review")}
            dimmed={dimmed}
            onSelect={pick("review")}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* A nominal breakdown of ONE value is not a breakdown — a repo-scoped
            view would render a single full-width bar reading "100%", which
            says nothing and offers a filter that selects everything. Ordinal
            cards below always render: an empty bucket is information. */}
        {stats.authors.distinct > 1 ? (
          <ChartCard
            title="by author"
            hint={countHint(stats.authors.distinct, "author")}
          >
            <BarList
              slices={stats.authors.slices}
              total={stats.total}
              scale={maxOf(stats.authors.slices)}
              colorAt={() => NOMINAL}
              activeKey={keyFor("author")}
              dimmed={dimmed}
              onSelect={pick("author")}
              footnote={
                stats.authors.hidden
                  ? `+${stats.authors.hidden} more author${stats.authors.hidden === 1 ? "" : "s"}`
                  : undefined
              }
            />
          </ChartCard>
        ) : null}

        {stats.repos.distinct > 1 ? (
          <ChartCard
            title="by repo"
            hint={countHint(stats.repos.distinct, "repo")}
          >
            <BarList
              slices={stats.repos.slices}
              total={stats.total}
              scale={maxOf(stats.repos.slices)}
              colorAt={() => NOMINAL}
              activeKey={keyFor("repo")}
              dimmed={dimmed}
              onSelect={pick("repo")}
              footnote={
                stats.repos.hidden
                  ? `+${stats.repos.hidden} more repo${stats.repos.hidden === 1 ? "" : "s"}`
                  : undefined
              }
            />
          </ChartCard>
        ) : null}

        <ChartCard title="idle for" hint="since last activity">
          <BarList
            slices={stats.idle}
            total={stats.total}
            scale={stats.total}
            colorAt={(i) => RAMP[i]}
            activeKey={keyFor("idle")}
            dimmed={dimmed}
            onSelect={pick("idle")}
          />
        </ChartCard>

        <ChartCard title="size" hint="S <50 · M <250 · L <1k · XL">
          <BarList
            slices={stats.size}
            total={stats.total}
            scale={stats.total}
            colorAt={(i) => RAMP[i]}
            activeKey={keyFor("size")}
            dimmed={dimmed}
            onSelect={pick("size")}
          />
        </ChartCard>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border bg-background",
        // 60vh, not 45: the drawer's normal content (tiles plus the two
        // bands) is ~400px, and at 45vh it clipped the bar lists mid-row so a
        // top-6 read as a top-2. The scroll stays as the safety valve for a
        // short window, not as the usual case.
        "px-4 py-3 flex flex-col gap-3 max-h-[60vh] overflow-y-auto",
      )}
    >
      {children}
    </div>
  );
}

function maxOf(slices: Slice[]): number {
  return slices.reduce((max, s) => Math.max(max, s.value), 0);
}

function countHint(distinct: number, noun: string): string | undefined {
  if (distinct <= 1) return undefined;
  const all = `${distinct} ${noun}s`;
  return distinct > NOMINAL_LIMIT ? `${all} · top ${NOMINAL_LIMIT}` : all;
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
