// The wire shapes of a review comment GitHub accepts, and the validation of
// the two requests that post one OUTSIDE a review (a line comment now, a
// reply now). Pure, so the server's write path and its tests share one
// spelling of "what may be posted".
import { isPlainObject } from "../is-plain-object";
import { isFullSha } from "./prKey";
import type { DiffSide, PendingComment } from "../review-types";

/** A staged or direct comment, before it becomes GitHub's REST shape. */
export type CommentDraft = Pick<
  PendingComment,
  "path" | "line" | "startLine" | "side" | "body" | "suggestion"
>;

/** `POST …/comment` — a draft plus the commit its lines were read from. */
export type LineCommentRequest = CommentDraft & { headSha: string };

/** `POST …/reply`. */
export type ReplyRequest = { commentId: number; body: string };

/** What either direct post answers with (the server adds `ok`). */
export type PostedComment = { commentId: number; url: string };
export type DirectPostResult = PostedComment & { ok: true };

export type RestReviewComment = {
  path: string;
  line: number;
  side: DiffSide;
  start_line?: number;
  start_side?: DiffSide;
  body: string;
};

/** REST shape: the suggestion becomes a fence under the body, and a one-line
 * range sends no `start_line` (GitHub 422s on start_line === line). */
export function restCommentOf(c: CommentDraft): RestReviewComment {
  const body =
    c.suggestion !== undefined
      ? `${c.body}${c.body.trim() ? "\n\n" : ""}\`\`\`suggestion\n${c.suggestion}\n\`\`\``
      : c.body;
  return {
    path: c.path,
    line: c.line,
    side: c.side,
    ...(c.startLine !== undefined && c.startLine !== c.line
      ? { start_line: c.startLine, start_side: c.side }
      : {}),
    body,
  };
}

const isLine = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * `POST …/comment` body → a comment pinned to the commit the reviewer was
 * LOOKING AT. `headSha` is required, not defaulted: GitHub anchors `line`
 * against `commit_id`, and the PR's tip may have moved since the diff was
 * drawn — posting against a commit nobody saw would land the comment on
 * whatever line now carries that number.
 */
export function parseLineCommentRequest(
  body: unknown,
): { commitId: string; comment: CommentDraft } | { error: string } {
  const shape =
    "expected { headSha, path, line, startLine?, side: LEFT|RIGHT, body, suggestion? }";
  if (!isPlainObject(body)) return { error: shape };
  const { headSha, path, line, startLine, side, suggestion } = body;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!isFullSha(headSha))
    return { error: "headSha must be a full 40-character commit sha" };
  if (typeof path !== "string" || !path) return { error: shape };
  if (!isLine(line)) return { error: shape };
  if (side !== "LEFT" && side !== "RIGHT") return { error: shape };
  if (startLine !== undefined && (!isLine(startLine) || startLine > line))
    return { error: "startLine must be a line number at or above line" };
  if (suggestion !== undefined && typeof suggestion !== "string")
    return { error: shape };
  if (!text && suggestion === undefined)
    return { error: "nothing to post — the comment is empty" };
  return {
    commitId: headSha,
    comment: {
      path,
      line,
      side,
      body: text,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(suggestion !== undefined ? { suggestion } : {}),
    },
  };
}

/** `POST …/reply` body. `commentId` is the REST id of the thread's FIRST
 * comment — GitHub's replies endpoint refuses a reply to a reply. */
export function parseReplyRequest(
  body: unknown,
): ReplyRequest | { error: string } {
  if (!isPlainObject(body) || !isLine(body.commentId))
    return { error: "expected { commentId, body }" };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { error: "nothing to post — the reply is empty" };
  return { commentId: body.commentId, body: text };
}
