// /api/reviews/:prId — the local pending-review draft. prId ("owner/repo#n")
// travels URL-encoded as one path segment.
import { API_PATHS } from "../../shared/api-paths";
import { matchIdPath } from "../pathMatch";
import { parseJsonBody } from "../requestJson";
import { deleteReview, loadReview, saveReview, validateReview } from "./store";

export async function handleReviews(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const match = matchIdPath(url.pathname, API_PATHS.REVIEWS);
  if (!match || match.rest !== "")
    return new Response("Not Found", { status: 404 });
  const prId = match.id;

  if (req.method === "GET") {
    return Response.json({ review: await loadReview(prId) });
  }

  if (req.method === "PUT") {
    const review = validateReview(await parseJsonBody(req));
    if (!review || review.prId !== prId) {
      return Response.json(
        { error: "invalid PendingReview body" },
        { status: 400 },
      );
    }
    return Response.json({ review: await saveReview(review) });
  }

  if (req.method === "DELETE") {
    await deleteReview(prId);
    return Response.json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
