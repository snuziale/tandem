import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPulseHistory } from "../api/pulse";
import { useConfigStatus } from "./useConfigStatus";
import { DEFAULT_ROTTING_DAYS, type PulseOptions } from "../shared/pulse";
import { useSettings } from "./useSettings";

/**
 * Everything pulse needs that isn't a row: the viewer's login (so
 * "blocked on you" can mean anything at all) and the team's staleness line.
 * One hook so the table, the drawer and the header pill can never disagree.
 */
export function usePulseOptions(now: number): PulseOptions {
  const status = useConfigStatus();
  const settings = useSettings();
  const viewerLogin = status.data?.login ?? null;
  const rottingDays = settings.data?.pulse.rottingDays ?? DEFAULT_ROTTING_DAYS;
  // Stable identity: this object is a useMemo dependency in QueueView (the
  // facet filter), QueueTable (grouping) and StatsDrawer (the whole
  // breakdown). A fresh literal every render would invalidate all three on
  // every render, which is exactly the work those memos exist to avoid.
  return useMemo(
    () => ({ now, viewerLogin, rottingDays }),
    [now, viewerLogin, rottingDays],
  );
}

/** The daily rollup for one view. Polled lazily — it changes once a day. */
export function usePulseHistory(viewId: string | null, days = 30) {
  return useQuery({
    queryKey: ["pulse", "history", viewId, days],
    queryFn: () => fetchPulseHistory(viewId as string, days),
    enabled: !!viewId,
    staleTime: 5 * 60_000,
  });
}
