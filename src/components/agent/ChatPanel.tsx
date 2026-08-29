// The conversation half of the agent pane: the reviewer's second cursor.
//
// Three things it does that a Q&A box does not. It SEES where you are — the
// pane's one line selection rides on the turn as an anchor (attention, never
// identity: `chatKeyOf` is untouched, so a drag can never fork the thread). It
// MOVES you — every `path.ts:42` in its prose is a control that scrolls the
// diff. And it WRITES INTO YOUR DRAFT — a proposal can be a comment at lines
// you pointed at, which is the one action kind that needs no run at all.
//
// Everything it proposes is still a CHIP the reviewer clicks — violet, because
// it is machine-authored (spec §3's provenance colour). Applying edits a
// finding or the draft; GitHub is still only ever written by submit.ts.
//
// MOUNT THIS KEYED BY SCOPE: a different finding is a different conversation,
// and the remount is what clears the composer draft and the streaming buffer
// (resetting them in an effect is what the React Compiler lint forbids).
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Spinner, Textarea, cn } from "@uipath/apollo-wind";
import { Trash2, X } from "lucide-react";
import { useChat, type ChatHop } from "../../hooks/useChat";
import { useChatSessions } from "../../hooks/useChatSessions";
import { chatKeyOf, type ChatAnchor } from "../../shared/chat-types";
import type { AgentRun, Finding } from "../../shared/agent-types";
import type {
  DiffSide,
  FileChange,
  PendingReview,
  PrId,
} from "../../shared/review-types";
import { spanLabel, type PaneAnchor } from "../pr/annotations";
import { fileName } from "../../utils/agentFormat";
import { ChatMessageView } from "./ChatMessageView";
import { Markdown } from "../common/Markdown";
import { resolveCodeRef, type CodeRef } from "../common/codeRefs";
import { Shortcut } from "../common/Kbd";
import { SHIFT } from "../../keyboard/platform";
import {
  completeMention,
  expandSlash,
  matchingCommands,
  matchingPaths,
  mentionPrefix,
  mentionedPaths,
  slashPrefix,
} from "./chatCommands";
import { chatOpeners } from "./chatOpeners";
import { PriorThreads } from "./PriorThreads";

type Props = {
  prId: PrId;
  headSha: string;
  /** Set when the pane has a focused finding — the conversation narrows to it. */
  finding: Finding | null;
  /** For turn zero and the openers; both are free, neither calls a model. */
  run: AgentRun | undefined;
  review: PendingReview | null;
  files: readonly FileChange[];
  /** Where the pane's ONE line selection is pointing right now. */
  anchor: PaneAnchor | null;
  /** Jump the diff to a citation the agent wrote, and mark the lines it named.
   * `startLine` carries a range (`patch.ts:40-52`). */
  onNavigate: (
    path: string,
    line: number,
    side: DiffSide,
    startLine?: number,
  ) => void;
  onClearScope: () => void;
};

/** How the header names where the selection came from. A composer and a
 * clicked finding are both "these lines", but only one of them is a sentence
 * the reviewer is halfway through writing. */
const SOURCE_LABEL: Record<PaneAnchor["source"], string> = {
  composer: "composing",
  revealed: "cited",
  search: "match",
  comment: "your comment",
  thread: "thread",
  finding: "finding",
};

const MAX_MENTION_ROWS = 6;

function anchorOf(pane: PaneAnchor): ChatAnchor {
  return {
    path: pane.path,
    side: pane.side,
    line: pane.line,
    startLine: pane.startLine,
  };
}

export function ChatPanel({
  prId,
  headSha,
  finding,
  run,
  review,
  files,
  anchor,
  onNavigate,
  onClearScope,
}: Props) {
  const chat = useChat({ prId, headSha, findingId: finding?.id });
  const messages = chat.session?.messages ?? [];
  const [draft, setDraft] = useState("");
  // The reviewer can drop the anchor for a turn without giving up the
  // selection itself — the highlight belongs to the diff, not to chat.
  const [anchorOff, setAnchorOff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Every thread on this PR, across its commits — fetched only while THIS one
  // is empty, which is also the only time it is rendered (see PriorThreads).
  const sessions = useChatSessions(prId, messages.length === 0);
  const paths = files.map((f) => f.path);
  const activeAnchor = anchorOff ? null : anchor;

  // Follow the tail: new messages and every streamed chunk.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.streaming, chat.statusLabel, chat.hops.length]);

  const ask = (text: string) => {
    const question = expandSlash(text.trim());
    if (!question || chat.thinking || chat.sending) return;
    chat.send(question, {
      anchor: activeAnchor ? anchorOf(activeAnchor) : undefined,
      contextPaths: mentionedPaths(text, paths),
    });
    setDraft("");
  };

  // A citation is only worth a jump if it names a file in this PR; an
  // ambiguous or foreign path stays inert rather than scrolling somewhere
  // arbitrary. Findings anchor on the RIGHT, and so does prose about them.
  const navigate = (ref: CodeRef) => {
    const path = resolveCodeRef(ref, paths);
    if (path) onNavigate(path, ref.line, "RIGHT", ref.startLine);
  };

  const command = slashPrefix(draft);
  const mention = command === null ? mentionPrefix(draft) : null;
  const commandRows = command === null ? [] : matchingCommands(command);
  const mentionRows =
    mention === null ? [] : matchingPaths(mention, paths, MAX_MENTION_ROWS);
  const openers =
    messages.length === 0 && !chat.thinking
      ? chatOpeners({ run, review, files, finding })
      : [];

  return (
    <div className="flex flex-col min-h-0 w-full" data-tandem-chat>
      <div className="flex items-center gap-1.5 px-3 h-8 border-b border-border shrink-0">
        <span
          className="text-[10px] uppercase tracking-wider font-mono shrink-0"
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
            <span className="truncate max-w-[14ch]">{finding.title}</span>
            <X className="size-3 shrink-0" />
          </button>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            whole PR
          </span>
        )}
        <span className="flex-1 min-w-0" />
        {/* The anchor chip is the reviewer's OWN mark, so it is --tandem-bar
            and never violet: violet says machine-authored, and pointing at
            lines is the most human thing in the panel. */}
        {anchor ? (
          <button
            type="button"
            onClick={() => setAnchorOff((off) => !off)}
            title={
              anchorOff
                ? `Ask about ${anchor.path}:${spanLabel(anchor)} again`
                : "Ask about the whole PR instead of these lines"
            }
            className={cn(
              "flex items-center gap-1 min-w-0 rounded border px-1 py-0.5 text-[10px] font-mono",
              anchorOff
                ? "border-border text-muted-foreground/70 hover:text-foreground"
                : "hover:brightness-110",
            )}
            style={
              anchorOff
                ? undefined
                : {
                    borderColor:
                      "color-mix(in srgb, var(--tandem-bar) 55%, transparent)",
                    color: "var(--tandem-bar)",
                    background:
                      "color-mix(in srgb, var(--tandem-bar) 10%, transparent)",
                  }
            }
          >
            <span className="truncate max-w-[18ch]">
              {fileName(anchor.path)}:{spanLabel(anchor)}
            </span>
            <span className="opacity-60 shrink-0">
              {anchorOff ? "off" : SOURCE_LABEL[anchor.source]}
            </span>
          </button>
        ) : null}
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
        {/* TURN ZERO. Pass 3 already wrote this and it is already paid for —
            rendering it as the conversation's first message rather than as a
            static block above the findings is what makes the panel read as a
            conversation that opens with the report, instead of a report with a
            chat drawer bolted underneath. It lives on the RUN, so it is not
            persisted into the transcript and never doubles. */}
        {run?.status === "ready" && run.summary && !finding ? (
          <div
            className="border-l-2 pl-2"
            style={{ borderColor: "var(--tandem-agent-dim)" }}
          >
            <div className="text-[10px] uppercase tracking-wider font-mono flex items-center gap-1.5">
              <span style={{ color: "var(--tandem-agent)" }}>
                {run.agentName ?? "agent"}
              </span>
              <span className="text-muted-foreground normal-case tracking-normal">
                opened this review
                {run.score !== undefined ? ` · score ${run.score}/100` : ""}
              </span>
            </div>
            <Markdown className="text-sm mt-0.5" onRefClick={navigate}>
              {run.summary}
            </Markdown>
          </div>
        ) : null}

        {messages.length === 0 && !chat.thinking ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {anchor
              ? "Ask about the lines you have selected, or anything else."
              : finding
                ? "Ask why it flagged this, push back on it, or tell it how to reword the comment."
                : "Ask about the diff, the plan it followed, or anything it did not flag."}{" "}
            It can write comments into your draft — nothing changes until you
            apply it.
          </p>
        ) : null}

        {/* Sits above the openers, because it answers an earlier question:
            "have I already asked this?" comes before "what should I ask?". */}
        {messages.length === 0 && !chat.thinking && sessions.data ? (
          <PriorThreads
            sessions={sessions.data}
            run={run}
            currentId={chatKeyOf(prId, headSha, finding?.id)}
          />
        ) : null}

        {openers.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[9.5px] uppercase tracking-wider font-mono text-muted-foreground">
              start here
            </div>
            <div className="flex flex-wrap gap-1">
              {openers.map((opener) => (
                <button
                  key={opener.id}
                  type="button"
                  onClick={() => ask(opener.question)}
                  title={opener.question}
                  className="rounded-full border px-2 py-0.5 text-[10px] text-left hover:brightness-110 max-w-full truncate"
                  style={{
                    borderColor: "var(--tandem-agent-dim)",
                    color: "var(--tandem-agent)",
                    background: "var(--tandem-agent-bg)",
                  }}
                >
                  {opener.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <ChatMessageView
            key={message.id}
            message={message}
            handlers={{
              applyingId: chat.applyingId,
              onApply: chat.apply,
              onApplyAll: chat.applyAll,
              onReject: chat.reject,
              onNavigate: navigate,
            }}
          />
        ))}

        {chat.thinking ? (
          <div
            style={{ borderColor: "var(--tandem-agent-dim)" }}
            className="border-l-2 pl-2"
          >
            {chat.hops.map((hop, i) => (
              <HopNote key={`${hop.paths.join()}-${i}`} hop={hop} />
            ))}
            {/* No `onRefClick` while it streams, deliberately. It arms the
                rehype ref walk, which would re-scan the whole tree on every
                token delta — and a half-typed `patch.ts:21` is not a citation
                to click yet. Refs come alive at turn-end, when the persisted
                message renders. */}
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
        {/* Both menus dock ABOVE the box, so the send row never moves. */}
        {commandRows.length > 0 ? (
          <div className="mb-1 rounded border border-border bg-background overflow-hidden">
            {commandRows.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => {
                  setDraft(`/${c.name} `);
                  inputRef.current?.focus();
                }}
                className="w-full text-left px-2 py-1 hover:bg-accent/40 flex items-baseline gap-2"
              >
                <span
                  className="text-[11px] font-mono"
                  style={{ color: "var(--tandem-agent)" }}
                >
                  /{c.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {c.hint}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {mentionRows.length > 0 ? (
          <div className="mb-1 rounded border border-border bg-background overflow-hidden">
            {mentionRows.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => {
                  setDraft((text) => completeMention(text, path));
                  inputRef.current?.focus();
                }}
                className="w-full text-left px-2 py-1 hover:bg-accent/40 text-[11px] font-mono truncate"
              >
                {path}
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          ref={inputRef}
          data-tandem-chat-input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
              return;
            }
            // Tab takes the first row of whichever menu is open — the only way
            // a typed `/` or `@` is faster than typing the whole thing out.
            if (e.key === "Tab" && commandRows.length > 0) {
              e.preventDefault();
              setDraft(`/${commandRows[0].name} `);
              return;
            }
            if (e.key === "Tab" && mentionRows.length > 0) {
              e.preventDefault();
              setDraft((text) => completeMention(text, mentionRows[0]));
              return;
            }
            // A chat box sends on ↵ (⇧↵ for a newline) — the app's ⌘↵ means
            // "commit this box" everywhere else, so it stays as an alias for
            // muscle memory, but it is NOT the primary key here.
            if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          placeholder={
            activeAnchor
              ? `Ask about ${fileName(activeAnchor.path)}:${spanLabel(activeAnchor)}…`
              : finding
                ? "Ask about this finding…"
                : "Ask about this PR…"
          }
          className="min-h-14 text-sm"
        />
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-mono text-muted-foreground flex-1 inline-flex items-baseline gap-1 min-w-0">
            <Shortcut keys="↵" /> send
            <span className="opacity-50 mx-0.5">·</span>
            <Shortcut keys={`${SHIFT}+↵`} /> newline
            <span className="opacity-50 mx-0.5">·</span>
            <span className="truncate">/ · @</span>
            {chat.session && chat.session.tokensUsed > 0 ? (
              <>
                <span className="opacity-50 mx-0.5">·</span>
                <span className="shrink-0">
                  {Math.round(chat.session.tokensUsed / 1000)}k tok
                </span>
              </>
            ) : null}
          </span>
          <Button
            size="2xs"
            variant="outline"
            disabled={!draft.trim() || chat.thinking || chat.sending}
            onClick={() => ask(draft)}
          >
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One `needContext` round trip. The turn re-asks from scratch afterwards, so
 * the prose written before it is not the answer — but deleting it mid-stream
 * is what made the panel feel unreliable. It stays, dimmed and clamped, under
 * the files it went to fetch.
 */
function HopNote({ hop }: { hop: ChatHop }) {
  return (
    <div className="mb-1.5 border-l border-border pl-2 -ml-2">
      <div className="text-[10px] font-mono text-muted-foreground">
        asked for {hop.paths.join(", ")} · re-reading
      </div>
      {hop.prose.trim() ? (
        <div className="text-[10px] text-muted-foreground/60 line-clamp-2 italic">
          {hop.prose.trim()}
        </div>
      ) : null}
    </div>
  );
}
