// The conversation half of the agent pane: ask about the PR, or about one
// finding, and refine what the agent wrote.
//
// Everything the agent proposes here is a CHIP the reviewer clicks — violet,
// because it is machine-authored (spec §1's provenance color). Applying edits
// the finding or the draft; GitHub is still only ever written by submit.ts.
//
// MOUNT THIS KEYED BY SCOPE: a different finding is a different conversation,
// and the remount is what clears the composer draft and the streaming buffer
// (resetting them in an effect is what the React Compiler lint forbids).
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Spinner, Textarea, cn } from "@uipath/apollo-wind";
import { Trash2, X } from "lucide-react";
import { useChat } from "../../hooks/useChat";
import type { ChatAction, ChatMessage } from "../../shared/chat-types";
import type { Finding } from "../../shared/agent-types";
import type { PrId } from "../../shared/review-types";
import { Markdown } from "../common/Markdown";
import { Shortcut } from "../common/Kbd";
import { SHIFT } from "../../keyboard/platform";

type Props = {
  prId: PrId;
  headSha: string;
  /** Set when the pane has a focused finding — the conversation narrows to it. */
  finding: Finding | null;
  onClearScope: () => void;
};

const ACTION_LABEL: Record<ChatAction["kind"], string> = {
  "revise-finding": "rewrite finding",
  "dismiss-finding": "dismiss finding",
  "new-finding": "new finding",
  "revise-comment": "rewrite staged comment",
};

export function ChatPanel({ prId, headSha, finding, onClearScope }: Props) {
  const chat = useChat({ prId, headSha, findingId: finding?.id });
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = chat.session?.messages ?? [];

  // Follow the tail: new messages and every streamed chunk.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.streaming, chat.statusLabel]);

  const submit = () => {
    const text = draft.trim();
    if (!text || chat.thinking || chat.sending) return;
    chat.send(text);
    setDraft("");
  };

  return (
    <div className="flex flex-col min-h-0 w-full">
      <div className="flex items-center gap-1.5 px-3 h-8 border-b border-border shrink-0">
        <span
          className="text-[10px] uppercase tracking-wider font-mono"
          style={{ color: "var(--tandem-agent)" }}
        >
          ● chat
        </span>
        {finding ? (
          <button
            type="button"
            onClick={onClearScope}
            title="Ask about the whole PR instead"
            className="flex items-center gap-1 min-w-0 rounded px-1 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            <span className="truncate max-w-[16ch]">{finding.title}</span>
            <X className="size-3 shrink-0" />
          </button>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground">
            whole PR
          </span>
        )}
        <span className="flex-1" />
        {chat.session && messages.length > 0 ? (
          <Button
            size="2xs"
            icon
            variant="ghost"
            aria-label="Clear this conversation"
            onClick={chat.clear}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3"
      >
        {messages.length === 0 && !chat.thinking ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {finding
              ? "Ask why it flagged this, push back on it, or tell it how to reword the comment."
              : "Ask about the diff, the plan it followed, or anything it did not flag."}{" "}
            It can propose edits to its own findings and to your staged comments
            — nothing changes until you apply it.
          </p>
        ) : null}

        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            applyingId={chat.applyingId}
            onApply={chat.apply}
            onReject={chat.reject}
          />
        ))}

        {chat.thinking ? (
          <div
            style={{ borderColor: "var(--tandem-agent-dim)" }}
            className="border-l-2 pl-2"
          >
            {chat.streaming ? (
              <Markdown className="text-sm">{chat.streaming}</Markdown>
            ) : null}
            <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
              <Spinner className="size-3" />
              {chat.statusLabel ?? "thinking"}
              <button
                type="button"
                className="hover:text-foreground underline"
                onClick={chat.cancel}
              >
                cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-2 shrink-0">
        <Textarea
          data-tandem-chat-input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
              return;
            }
            // A chat box sends on ↵ (⇧↵ for a newline) — the app's ⌘↵ means
            // "commit this box" everywhere else, so it stays as an alias for
            // muscle memory, but it is NOT the primary key here.
            if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            finding ? "Ask about this finding…" : "Ask about this PR…"
          }
          className="min-h-14 text-sm"
        />
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-mono text-muted-foreground flex-1 inline-flex items-baseline gap-1">
            <Shortcut keys="↵" /> send
            <span className="opacity-50 mx-0.5">·</span>
            <Shortcut keys={`${SHIFT}+↵`} /> newline
            {chat.session && chat.session.tokensUsed > 0 ? (
              <>
                <span className="opacity-50 mx-0.5">·</span>
                <span>{Math.round(chat.session.tokensUsed / 1000)}k tok</span>
              </>
            ) : null}
          </span>
          <Button
            size="2xs"
            variant="outline"
            disabled={!draft.trim() || chat.thinking || chat.sending}
            onClick={submit}
          >
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}

function Message({
  message,
  applyingId,
  onApply,
  onReject,
}: {
  message: ChatMessage;
  applyingId: string | null;
  onApply: (actionId: string) => void;
  onReject: (actionId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="rounded bg-accent/40 px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          you
        </div>
        <div className="text-sm whitespace-pre-wrap">{message.text}</div>
      </div>
    );
  }

  return (
    <div
      className="border-l-2 pl-2"
      style={{ borderColor: "var(--tandem-agent-dim)" }}
    >
      <div className="text-[10px] uppercase tracking-wider font-mono flex items-center gap-1.5">
        <span style={{ color: "var(--tandem-agent)" }}>
          {message.agentName ?? "agent"}
        </span>
        {message.contextRead?.length ? (
          <span className="text-muted-foreground truncate">
            read {message.contextRead.join(", ")}
          </span>
        ) : null}
      </div>
      {message.error ? (
        <div className="text-xs text-destructive font-mono break-words mt-0.5">
          {message.error}
        </div>
      ) : null}
      {message.text ? (
        <Markdown className="text-sm mt-0.5">{message.text}</Markdown>
      ) : null}
      {message.actions?.length ? (
        <div className="mt-1.5 space-y-1">
          {message.actions.map((action) => (
            <ActionChip
              key={action.id}
              action={action}
              busy={applyingId === action.id}
              onApply={onApply}
              onReject={onReject}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionChip({
  action,
  busy,
  onApply,
  onReject,
}: {
  action: ChatAction;
  busy: boolean;
  onApply: (actionId: string) => void;
  onReject: (actionId: string) => void;
}) {
  const done = action.state !== "proposed";
  return (
    <div
      className={cn(
        "rounded border px-2 py-1.5",
        done ? "border-border opacity-70" : "border-[var(--tandem-agent-dim)]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="text-[10px] uppercase tracking-wider font-mono"
          style={{ color: "var(--tandem-agent)" }}
        >
          {ACTION_LABEL[action.kind]}
        </span>
        {action.state === "applied" ? (
          <span className="text-[10px] font-mono text-emerald-400">
            ✓ applied
          </span>
        ) : null}
        {action.state === "rejected" ? (
          <span className="text-[10px] font-mono text-muted-foreground">
            dismissed
          </span>
        ) : null}
      </div>
      <div className="text-xs mt-0.5">{action.why}</div>
      <Preview action={action} />
      {action.error ? (
        <div className="text-[10px] text-destructive font-mono mt-0.5">
          {action.error}
        </div>
      ) : null}
      {!done ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <Button
            size="2xs"
            variant="outline"
            disabled={busy}
            style={{
              borderColor: "var(--tandem-agent-dim)",
              color: "var(--tandem-agent)",
            }}
            onClick={() => onApply(action.id)}
          >
            {busy ? "Applying…" : "Apply"}
          </Button>
          <Button
            size="2xs"
            variant="ghost"
            disabled={busy}
            onClick={() => onReject(action.id)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What applying would actually write — the reviewer decides on the text, not the label. */
function Preview({ action }: { action: ChatAction }) {
  const body =
    action.kind === "revise-finding"
      ? [action.title, action.body].filter(Boolean).join(" — ")
      : action.kind === "revise-comment"
        ? action.body
        : action.kind === "new-finding"
          ? `${action.finding.path}:${action.finding.endLine} · ${action.finding.severity} · ${action.finding.title}`
          : null;
  if (!body) return null;
  return (
    <div className="mt-1 text-[11px] font-mono text-muted-foreground border border-border rounded p-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">
      {body}
    </div>
  );
}
