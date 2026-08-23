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
import { BarList, ChartCard, StatTile, StatusStrip } from "./charts";

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
  shownCount,
  matching,
  now,
  facet,
  onFacet,
}: Props) {
  const stats = useMemo(() => computeQueueStats(rows ?? [], now), [rows, now]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
            label="awaiting you"
            value={stats.awaiting}
            sub="review required"
            active={sameFacet(facet, { dim: "review", value: "awaiting" })}
            onClick={toggle({ dim: "review", value: "awaiting" })}
          />
          <StatTile
            label="failing"
            value={stats.failing}
            sub="checks red"
            tone={stats.failing > 0 ? "danger" : undefined}
            active={sameFacet(facet, { dim: "checks", value: "failing" })}
            onClick={toggle({ dim: "checks", value: "failing" })}
          />
          <StatTile
            label="idle > 7d"
            value={stats.idleOverWeek}
            sub="untouched a week+"
            tone={stats.idleOverWeek > 0 ? "warning" : undefined}
            active={sameFacet(facet, { dim: "idle", value: ">7d" })}
            onClick={toggle({ dim: "idle", value: ">7d" })}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-3">
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

        <div className="sm:col-span-2">
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
        </div>

        <div className="sm:col-span-2">
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
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border bg-background",
        "px-4 py-3 flex flex-col gap-3 max-h-[45vh] overflow-y-auto",
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
