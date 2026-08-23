// The ONLY code that writes to GitHub (spec §1 principle 1, §5 writes).
// Exactly two operations exist: submitting the pending review as one GitHub
// review, and the queue's one-click empty approve. Nothing else in the server
// may POST/PUT/DELETE against the GitHub API — keep it that way.
import type { GitHubCreds } from "../../shared/github-schema";
import type { PrRef } from "../../shared/gh/prKey";
import { rest } from "./client";

type RestReviewComment = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
  body: string;
};

export type SubmitReviewInput = {
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
  commitId?: string;
  comments: RestReviewComment[];
};

export async function submitReview(
  creds: GitHubCreds,
  ref: PrRef,
  input: SubmitReviewInput,
): Promise<{ reviewId: number; url: string }> {
  const { data } = await rest<{ id: number; html_url: string }>(
    creds,
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`,
    {
      method: "POST",
      body: {
        commit_id: input.commitId,
        event: input.verdict,
        body: input.body,
        comments: input.comments,
      },
    },
  );
  return { reviewId: data.id, url: data.html_url };
}

/** One-click approve from the queue: an empty APPROVE review. */
export function quickApprove(
  creds: GitHubCreds,
  ref: PrRef,
): Promise<{ reviewId: number; url: string }> {
  return submitReview(creds, ref, {
    verdict: "APPROVE",
    body: "",
    comments: [],
  });
}
