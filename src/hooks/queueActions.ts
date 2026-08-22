// Queue actions callable from both UI buttons and keyboard handlers (which
// run outside React, so these are plain functions over the queryClient).
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '@uipath/apollo-wind';
import { approvePr } from '../api/prs';
import type { PrId } from '../shared/review-types';

const inFlight = new Set<PrId>();

export async function approvePrAction(queryClient: QueryClient, prId: PrId): Promise<void> {
  if (inFlight.has(prId)) return;
  inFlight.add(prId);
  try {
    await approvePr(prId);
    toast.success(`Approved ${prId}`, { description: 'Submitted as one empty APPROVE review.' });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  } catch (e) {
    toast.error(`Approve failed for ${prId}`, { description: e instanceof Error ? e.message : undefined });
  } finally {
    inFlight.delete(prId);
  }
}

export function openPrExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}
