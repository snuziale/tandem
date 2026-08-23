// Local pending-review drafts, keyed by prId, in ~/.tandem/reviews.json.
// The draft is the whole point of the product: agent findings and human
// comments accumulate here and NOTHING reaches GitHub until submit. Drafts
// survive reloads and the browser/native split because they live server-side.
import { isPlainObject } from "../../shared/isPlainObject";
import type { PendingComment, PendingReview } from "../../shared/review-types";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../storage/jsonFile";

const FILE = "reviews.json";

function file(): string {
  return storagePath(FILE);
}

type ReviewsFile = { reviews: Record<string, PendingReview> };

async function readAll(): Promise<ReviewsFile> {
  const text = await readTextFile(file());
  if (text === null) return { reviews: {} };
  try {
    const raw = JSON.parse(text) as unknown;
    if (isPlainObject(raw) && isPlainObject(raw.reviews))
      return { reviews: raw.reviews as Record<string, PendingReview> };
  } catch {
    console.error(
      `[reviews] ${file()} is malformed; starting empty (file preserved until next write)`,
    );
  }
  return { reviews: {} };
}

export async function loadReview(prId: string): Promise<PendingReview | null> {
  const all = await readAll();
  return all.reviews[prId] ?? null;
}

export async function saveReview(review: PendingReview): Promise<void> {
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    all.reviews[review.prId] = {
      ...review,
      updatedAt: new Date().toISOString(),
    };
    await writeTextFile(file(), JSON.stringify(all, null, 2));
  });
}

export async function deleteReview(prId: string): Promise<void> {
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    delete all.reviews[prId];
    await writeTextFile(file(), JSON.stringify(all, null, 2));
  });
}

export function validateReview(raw: unknown): PendingReview | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.prId !== "string" || typeof raw.headSha !== "string")
    return null;
  if (!Array.isArray(raw.comments) || !Array.isArray(raw.viewedFiles))
    return null;
  const comments: PendingComment[] = [];
  for (const c of raw.comments) {
    if (!isPlainObject(c)) return null;
    if (
      typeof c.localId !== "string" ||
      typeof c.path !== "string" ||
      typeof c.body !== "string"
    )
      return null;
    if (typeof c.line !== "number" || (c.side !== "LEFT" && c.side !== "RIGHT"))
      return null;
    comments.push({
      localId: c.localId,
      findingId: typeof c.findingId === "string" ? c.findingId : undefined,
      path: c.path,
      line: c.line,
      startLine: typeof c.startLine === "number" ? c.startLine : undefined,
      side: c.side,
      body: c.body,
      suggestion: typeof c.suggestion === "string" ? c.suggestion : undefined,
      anchorMoved: c.anchorMoved === true ? true : undefined,
    });
  }
  const verdict = raw.verdict;
  return {
    prId: raw.prId,
    headSha: raw.headSha,
    comments,
    verdict:
      verdict === "APPROVE" ||
      verdict === "REQUEST_CHANGES" ||
      verdict === "COMMENT"
        ? verdict
        : undefined,
    summaryBody:
      typeof raw.summaryBody === "string" ? raw.summaryBody : undefined,
    viewedFiles: raw.viewedFiles.filter(
      (v): v is string => typeof v === "string",
    ),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}
