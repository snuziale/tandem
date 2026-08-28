import { cn } from "@uipath/apollo-wind";
import type { ReviewThread } from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import { relativeAge } from "../../utils/time";
import { Markdown } from "../common/Markdown";
import { focusCardProps } from "./annotations";

// An existing human review thread, rendered inline in the diff. Blue rail =
// human-authored (violet is reserved for the agent).
export function ThreadCard({ thread }: { thread: ReviewThread }) {
  const focusedCommentId = useUiStore((s) => s.focusedCommentId);
  const focused = focusedCommentId === thread.id;
  return (
    <div
      {...focusCardProps(thread.id, focused)}
      className={cn(
        "my-1 mx-2 rounded border bg-background text-foreground",
        focused ? "border-blue-400" : "border-border",
        "border-l-2 border-l-blue-400",
        thread.isResolved && "opacity-60",
      )}
    >
      {thread.comments.map((comment, i) => (
        <div
          key={comment.id}
          className={cn("px-3 py-2", i > 0 && "border-t border-border/60")}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              @{comment.author}
            </span>
            <span>{relativeAge(comment.createdAt)}</span>
            {i === 0 && thread.isResolved ? (
              <span className="ml-auto text-[10px] uppercase tracking-wide border border-border rounded px-1">
                resolved
              </span>
            ) : null}
            {i === 0 && thread.isOutdated ? (
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wide border border-border rounded px-1",
                  !thread.isResolved && "ml-auto",
                )}
              >
                outdated
              </span>
            ) : null}
          </div>
          <Markdown className="mt-1">{comment.bodyMarkdown}</Markdown>
        </div>
      ))}
    </div>
  );
}
