// One turn of a conversation, drawn the same way wherever it is read.
//
// The live pane and the read-back of an earlier thread render the same
// `ChatMessage`, and for a while they did it with two copies of this JSX —
// which had already drifted before either shipped: the replay dropped
// `contextRead` and printed a raw `stage-comment` where the live pane said
// "comment on your draft". A conversation you read back has to be the
// conversation you had.
//
// The one real difference is interactivity, so that is the one prop: without
// handlers the action chips render as inert labels, which is what a thread at
// another sha must do — its proposals were validated against a run that is
// gone.
import { Button, cn } from "@uipath/apollo-wind";
import type { ChatAction, ChatMessage } from "../../shared/chat-types";
import { fileName } from "../../utils/agentFormat";
import { spanLabel } from "../pr/annotations";
import type { CodeRef } from "../common/codeRefs";
import { Markdown } from "../common/Markdown";
import { Shortcut } from "../common/Kbd";

const ACTION_LABEL: Record<ChatAction["kind"], string> = {
  "revise-finding": "rewrite finding",
  "dismiss-finding": "dismiss finding",
  "new-finding": "new finding",
  "revise-comment": "rewrite staged comment",
  "stage-comment": "comment on your draft",
};

/** The handlers a LIVE conversation supplies. Absent = read-only. */
export type MessageHandlers = {
  applyingId: string | null;
  onApply: (actionId: string) => void;
  onApplyAll: (actionIds: string[]) => void;
  onReject: (actionId: string) => void;
  onNavigate: (ref: CodeRef) => void;
};

export function ChatMessageView({
  message,
  handlers,
}: {
  message: ChatMessage;
  handlers?: MessageHandlers;
}) {
  if (message.role === "user") {
    return (
      <div className="rounded bg-accent/40 px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground flex items-baseline gap-1.5">
          <span>you</span>
          {/* A past question's anchor is part of what it meant — a replayed
              transcript without it is a list of unmoored questions. */}
          {message.anchor ? (
            <span
              className="normal-case tracking-normal truncate"
              style={{ color: "var(--tandem-bar)" }}
            >
              {fileName(message.anchor.path)}:{spanLabel(message.anchor)}
            </span>
          ) : null}
        </div>
        <div className="text-sm whitespace-pre-wrap">{message.text}</div>
      </div>
    );
  }

  const actions = message.actions ?? [];
  const pending = actions.filter((a) => a.state === "proposed");

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
        <Markdown className="text-sm mt-0.5" onRefClick={handlers?.onNavigate}>
          {message.text}
        </Markdown>
      ) : null}
      {actions.length ? (
        <div className="mt-1.5 space-y-1">
          {handlers && pending.length > 1 ? (
            <button
              type="button"
              disabled={handlers.applyingId !== null}
              onClick={() => handlers.onApplyAll(pending.map((a) => a.id))}
              className="text-[10px] font-mono underline hover:brightness-110 disabled:opacity-50"
              style={{ color: "var(--tandem-agent)" }}
            >
              apply all {pending.length}
            </button>
          ) : null}
          {actions.map((action) =>
            handlers ? (
              <ActionChip
                key={action.id}
                action={action}
                busy={handlers.applyingId === action.id}
                onApply={handlers.onApply}
                onReject={handlers.onReject}
              />
            ) : (
              <span
                key={action.id}
                className="mr-1 inline-block rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
              >
                {ACTION_LABEL[action.kind]}
                {action.state === "applied" ? " · applied" : ""}
              </span>
            ),
          )}
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
      // y / x while either button has focus — the same vocabulary finding
      // triage uses. On the ROW, not on each button: keydown bubbles, and one
      // handler is what `CHAT_OWNED_KEYS` in PrDetailView is guarding.
      onKeyDown={(e) => {
        if (done) return;
        if (e.key === "y") onApply(action.id);
        if (e.key === "x") onReject(action.id);
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="text-[10px] uppercase tracking-wider font-mono"
          style={{ color: "var(--tandem-agent)" }}
        >
          {ACTION_LABEL[action.kind]}
        </span>
        <Where action={action} />
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
            {!busy ? <Shortcut keys="y" className="ml-1 opacity-70" /> : null}
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

/** The anchor an action would write at, when it has one. A comment landing in
 * the draft at lines you cannot see is the one thing that needs saying before
 * the body does. */
function Where({ action }: { action: ChatAction }) {
  const at =
    action.kind === "stage-comment"
      ? `${fileName(action.path)}:${spanLabel(action)}`
      : action.kind === "new-finding"
        ? `${fileName(action.finding.path)}:${action.finding.endLine}`
        : null;
  if (!at) return null;
  return (
    <span className="text-[10px] font-mono text-muted-foreground truncate">
      {at}
    </span>
  );
}

/** What applying would write: the prose, and the replacement as a real diff. */
type PreviewParts = { prose: string | null; suggestion: string | null };

/** One switch over the discriminant rather than two interleaved ternary
 * ladders — adding a kind is one case, not two nestings to get right. */
function previewOf(action: ChatAction): PreviewParts {
  switch (action.kind) {
    case "revise-finding":
      return {
        prose: [action.title, action.body].filter(Boolean).join(" — ") || null,
        // `null` here means "drop the suggestion", which is not a preview.
        suggestion:
          typeof action.suggestion === "string" ? action.suggestion : null,
      };
    case "stage-comment":
      return { prose: action.body, suggestion: action.suggestion ?? null };
    case "revise-comment":
      return { prose: action.body, suggestion: null };
    case "new-finding":
      return {
        prose: `${action.finding.severity} · ${action.finding.title}`,
        suggestion: action.finding.suggestion ?? null,
      };
    case "dismiss-finding":
      return { prose: null, suggestion: null };
  }
}

/**
 * A suggestion is a REPLACEMENT for real lines, so it is drawn as a diff of
 * those lines against the proposed ones — the alternative is a scroll box of
 * escaped markdown you have to apply before you can tell what changed.
 * `replaces` is computed server-side at sanitize time, off the same patch the
 * action was anchored against; without it (an older transcript, a file that
 * moved) the suggestion still renders, just as additions alone.
 *
 * Note the colours: the chip's rail and label stay violet because the proposal
 * is machine-authored, and the lines inside take the DIFF's own red and green.
 * Violet marks provenance; it must never tint content.
 */
function Preview({ action }: { action: ChatAction }) {
  const { prose, suggestion } = previewOf(action);
  const replaces = "replaces" in action ? (action.replaces ?? null) : null;
  if (!prose && !suggestion) return null;
  return (
    <div className="mt-1 space-y-1">
      {prose ? (
        <div className="text-[11px] font-mono text-muted-foreground border border-border rounded p-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">
          {prose}
        </div>
      ) : null}
      {suggestion ? (
        <SuggestionDiff replaces={replaces} suggestion={suggestion} />
      ) : null}
    </div>
  );
}

function SuggestionDiff({
  replaces,
  suggestion,
}: {
  replaces: string | null;
  suggestion: string;
}) {
  const removed = replaces === null ? [] : replaces.split("\n");
  const added = suggestion.split("\n");
  return (
    <div className="border border-border rounded overflow-hidden">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 bg-accent/30 border-b border-border">
        suggested change
      </div>
      <div className="max-h-40 overflow-auto font-mono text-[11px] leading-[1.5]">
        {removed.map((line, i) => (
          <div
            key={`d${i}`}
            className="whitespace-pre px-1.5 text-destructive"
            style={{
              background:
                "color-mix(in srgb, var(--destructive) 10%, transparent)",
            }}
          >
            {`− ${line}`}
          </div>
        ))}
        {added.map((line, i) => (
          <div
            key={`a${i}`}
            className="whitespace-pre px-1.5 text-emerald-500"
            style={{ background: "rgb(16 185 129 / 0.10)" }}
          >
            {`+ ${line}`}
          </div>
        ))}
      </div>
    </div>
  );
}
