import { useQueryClient } from "@tanstack/react-query";
import { postPrComment, replyToPrThread } from "../api/prs";
import type {
  LineCommentRequest,
  ReplyRequest,
} from "../shared/gh/reviewComment";
import type { PrId } from "../shared/review-types";

/**
 * The two writes that skip the pending review: a line comment now, and a reply
 * now. Both refetch the PR detail on success, so the new comment comes back as
 * an ordinary thread — and the refetch re-marks the PR seen, so your own
 * comment never lights the queue's unseen dot.
 *
 * Plain functions, NOT `useMutation`: a mutation's state lives in whichever
 * component calls the hook, and that is `DiffPane` — so every idle → pending →
 * settled step would re-render the whole diff to tell nobody anything. The
 * card that is posting owns that state (`usePostInPlace`), and only it
 * re-renders.
 */
export function useDirectComments(prId: PrId) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["pr", prId], exact: true });
  return {
    comment: (input: LineCommentRequest) =>
      postPrComment(prId, input).then(refresh),
    reply: (input: ReplyRequest) => replyToPrThread(prId, input).then(refresh),
  };
}
