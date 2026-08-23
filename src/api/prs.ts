import { API_PATHS } from "../shared/api-paths";
import { parsePrId } from "../shared/gh/prKey";
import type { FileChange, PrDetail, PrId } from "../shared/review-types";
import { apiRequest } from "./http";

export function prApiBase(prId: PrId): string {
  const ref = parsePrId(prId);
  if (!ref) throw new Error(`malformed prId: ${prId}`);
  return `${API_PATHS.PRS}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${ref.number}`;
}

export function approvePr(prId: PrId): Promise<{ ok: true; url: string }> {
  return apiRequest<{ ok: true; url: string }>(`${prApiBase(prId)}/approve`, {
    method: "POST",
  });
}

export function submitPr(
  prId: PrId,
  input: {
    verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    summaryBody?: string;
  },
): Promise<{ ok: true; url: string }> {
  return apiRequest<{ ok: true; url: string }>(`${prApiBase(prId)}/submit`, {
    method: "POST",
    body: input,
  });
}

export function fetchPrDetail(
  prId: PrId,
  signal?: AbortSignal,
): Promise<PrDetail> {
  return apiRequest<PrDetail>(prApiBase(prId), { signal });
}

export async function fetchPrFiles(
  prId: PrId,
  signal?: AbortSignal,
): Promise<FileChange[]> {
  const { files } = await apiRequest<{ files: FileChange[] }>(
    `${prApiBase(prId)}/files`,
    { signal },
  );
  return files;
}
