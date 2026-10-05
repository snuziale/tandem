// The ONLY code that writes to GitHub (spec §1 principle 1, §5 writes).
// Exactly four operations exist, every one of them a human's click:
// submitting the pending review as one GitHub review, the queue's one-click
// empty approve, and posting ONE comment outside a review — a line comment or
// a reply to an existing thread — from text the reviewer typed. Nothing else
// in the server may POST/PUT/DELETE against the GitHub API — keep it that way.
import type { GitHubCreds } from "../../shared/github-credentials";
import type { PrRef } from "../../shared/gh/prKey";
import type {
  PostedComment,
  RestReviewComment,
} from "../../shared/gh/reviewComment";
import { rest } from "./client";

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

/** One line comment, posted now rather than staged. `commitId` is the sha the
 * reviewer's diff was drawn from — `line` means nothing against any other. */
export function postLineComment(
  creds: GitHubCreds,
  ref: PrRef,
  commitId: string,
  comment: RestReviewComment,
): Promise<PostedComment> {
  return postPullComment(creds, ref, "", { commit_id: commitId, ...comment });
}

/** A reply on an existing thread. `commentId` is the thread's FIRST comment. */
export function replyToThread(
  creds: GitHubCreds,
  ref: PrRef,
  commentId: number,
  body: string,
): Promise<PostedComment> {
  return postPullComment(creds, ref, `/${commentId}/replies`, { body });
}

// The one request both comment writes make, so the audit surface stays a
// single URL family: `/pulls/:n/comments[suffix]`.
async function postPullComment(
  creds: GitHubCreds,
  ref: PrRef,
  suffix: string,
  body: Record<string, unknown>,
): Promise<PostedComment> {
  const { data } = await rest<{ id: number; html_url: string }>(
    creds,
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments${suffix}`,
    { method: "POST", body },
  );
  return { commentId: data.id, url: data.html_url };
}
