import { useState, type KeyboardEvent } from "react";
import { Button, Textarea, cn } from "@uipath/apollo-wind";
import { usePostInPlace } from "../../hooks/usePostInPlace";
import type { ReplyRequest } from "../../shared/gh/reviewComment";
import type { ReviewThread } from "../../shared/review-types";
import { MOD } from "../../keyboard/platform";
import { useUiStore } from "../../state/uiStore";
import { relativeAge } from "../../utils/time";
import { Shortcut } from "../common/Kbd";
import { Markdown } from "../common/Markdown";
import { focusCardProps } from "./annotations";
import { PostError } from "./PostError";

type Props = {
  thread: ReviewThread;
  /** Post a reply to GitHub now. Resolves once it has landed. Not offered
   * when the thread cannot be replied to (no `replyToId`). */
  onReply: (input: ReplyRequest) => Promise<unknown>;
};

// An existing human review thread, rendered inline in the diff. Blue rail =
// human-authored (violet is reserved for the agent).
export function ThreadCard({ thread, onReply }: Props) {
  const replyToId = thread.replyToId;
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
      {replyToId === undefined ? null : (
        <ReplyBox onPost={(body) => onReply({ commentId: replyToId, body })} />
      )}
    </div>
  );
}

// Folded to one quiet button until asked for: most threads are read, not
// answered, and an open box under every one would double the cards' height.
// A reply has no "stage" alternative here, so ⌘↵ posts — the button says so.
function ReplyBox({ onPost }: { onPost: (body: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const { posting, error, run, clearError } = usePostInPlace(onPost);

  const close = () => {
    setOpen(false);
    clearError();
  };
  const post = () => {
    if (!body.trim()) return;
    void run(body.trim()).then((landed) => {
      if (!landed) return;
      // The refetched thread brings the reply back as a comment above, so
      // the box only has to get out of the way.
      setBody("");
      setOpen(false);
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      post();
    }
  };

  if (!open)
    return (
      <div className="border-t border-border/60 px-3 py-1.5">
        <Button size="2xs" variant="ghost" onClick={() => setOpen(true)}>
          Reply…
        </Button>
      </div>
    );

  return (
    <div
      onKeyDown={onKeyDown}
      className="border-t border-border/60 px-3 py-2 space-y-2"
    >
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Reply…"
        className="min-h-14 text-sm font-mono"
      />
      <PostError error={error} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">
          posts to GitHub now, not with your review
        </span>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button size="xs" disabled={!body.trim() || posting} onClick={post}>
            {posting ? "Posting…" : "Reply"}
            <Shortcut keys={[`${MOD}+↵`]} />
          </Button>
        </div>
      </div>
    </div>
  );
}
