// Queue actions callable from both UI buttons and keyboard handlers (which
// run outside React, so these are plain functions over the queryClient).
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { approvePr } from "../api/prs";
import { startRun } from "../api/runs";
import type { PrId } from "../shared/review-types";

const inFlight = new Set<PrId>();

export async function approvePrAction(
  queryClient: QueryClient,
  prId: PrId,
): Promise<void> {
  if (inFlight.has(prId)) return;
  inFlight.add(prId);
  try {
    await approvePr(prId);
    toast.success(`Approved ${prId}`, {
      description: "Submitted as one empty APPROVE review.",
    });
    queryClient.invalidateQueries({ queryKey: ["queue"] });
  } catch (e) {
    toast.error(`Approve failed for ${prId}`, {
      description: e instanceof Error ? e.message : undefined,
    });
  } finally {
    inFlight.delete(prId);
  }
}

export function openPrExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}

const runsInFlight = new Set<PrId>();

/**
 * Start the agent on a PR from the queue — the first run, not a rerun, so it
 * is NOT forced: an existing run for the head sha comes back untouched (the
 * cache rule) and the row simply starts showing it.
 */
export async function startRunAction(
  queryClient: QueryClient,
  prId: PrId,
): Promise<void> {
  if (runsInFlight.has(prId)) return;
  runsInFlight.add(prId);
  try {
    await startRun(prId);
    // AWAITED: the caller's pending state is what the queue row renders while
    // the run starts, and `startRun` resolves before the run RECORD exists.
    // Returning here would flip the button back to "Run agent" until the next
    // refetch landed, which reads as a click that did nothing.
    await queryClient.invalidateQueries({ queryKey: ["runs"] });
  } catch (e) {
    toast.error(`Could not start run for ${prId}`, {
      description: e instanceof Error ? e.message : undefined,
    });
  } finally {
    runsInFlight.delete(prId);
  }
}
