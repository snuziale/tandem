import { API_PATHS } from "../shared/api-paths";
import type { PulseSnapshot } from "../shared/pulse-journal";
import { apiRequest } from "./http";

/** The daily rollup behind the drawer's sparkline. Empty until the queue has
 * polled at least once with the journal on. */
export async function fetchPulseHistory(
  viewId: string,
  days = 30,
): Promise<PulseSnapshot[]> {
  const params = new URLSearchParams({ view: viewId, days: String(days) });
  const { series } = await apiRequest<{ series: PulseSnapshot[] }>(
    `${API_PATHS.PULSE}/history?${params}`,
  );
  return series;
}
