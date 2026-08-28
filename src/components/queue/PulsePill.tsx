// The ambient surface that costs nothing: the active view's pulse, in the
// header, always on screen.
//
// It is the cheapest of the three tiers (the other two being /api/pulse.xbar
// and a real native tray) and it earns its place by being a CONTROL as well as
// a readout — every segment is the facet it names, so the glance and the
// drill-down are the same gesture. Zero counts render nothing: a row of "0 · 0
// · 0" is noise, and the absence of a mark is the clearest possible "none".
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import {
  PULSE_HEADLINE_STATES,
  PULSE_HINTS,
  PULSE_LABELS,
  pulseCounts,
  type PulseOptions,
} from "../../shared/pulse";
import { PULSE_COLOR, PULSE_ICON } from "./pulseIcons";
import type { PullRequest } from "../../shared/review-types";
import type { Facet } from "../../utils/queueStats";
import { sameFacet } from "../../utils/queueStats";

export function PulsePill({
  rows,
  opts,
  facet,
  onFacet,
}: {
  rows: PullRequest[] | undefined;
  opts: PulseOptions;
  facet: Facet | null;
  onFacet: (facet: Facet | null) => void;
}) {
  if (!rows || rows.length === 0) return null;
  const counts = pulseCounts(rows, opts);
  const shown = PULSE_HEADLINE_STATES.filter((state) => counts[state] > 0);
  if (shown.length === 0) return null;

  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {shown.map((state) => {
        const next: Facet = { dim: "pulse", value: state };
        const active = sameFacet(facet, next);
        const Icon = PULSE_ICON[state];
        return (
          <Tooltip key={state}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${counts[state]} ${PULSE_LABELS[state]}`}
                onClick={() => onFacet(active ? null : next)}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-mono tabular-nums",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active && "bg-accent",
                )}
                style={{ color: PULSE_COLOR[state] }}
              >
                <Icon className="size-3 shrink-0" aria-hidden />
                {counts[state]}
              </button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>
                {counts[state]} {PULSE_LABELS[state]} — {PULSE_HINTS[state]}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        );
      })}
    </span>
  );
}
