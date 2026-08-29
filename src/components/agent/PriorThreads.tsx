// The conversations you have already had about this pull request.
//
// A session is keyed by (PR, sha, finding) — which is right, and which meant
// that every new commit silently orphaned every thread you had. The server has
// always been able to list them; nothing asked. This is the way back.
//
// It appears only while the CURRENT conversation is empty. Once you are
// talking, older threads are not what the pane is for, and a permanent history
// control at the top of a chat is a drawer nobody opens.
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uipath/apollo-wind";
import { History, X } from "lucide-react";
import type { AgentRun } from "../../shared/agent-types";
import type { ChatSession } from "../../shared/chat-types";
import { relativeAge } from "../../utils/time";
import { shortSha } from "../../utils/agentFormat";
import { ChatMessageView } from "./ChatMessageView";

/** How a thread is named in the list. The finding's own title when we can
 * still resolve it, which is the case that matters — "one finding" tells you
 * nothing about which. */
function scopeLabel(session: ChatSession, run: AgentRun | undefined): string {
  if (!session.findingId) return "whole PR";
  const finding = run?.findings.find((f) => f.id === session.findingId);
  return finding ? finding.title : "one finding";
}

export function PriorThreads({
  sessions,
  run,
  currentId,
}: {
  sessions: readonly ChatSession[];
  /** The run at the CURRENT commit — the only findings whose titles we can
   * resolve. A thread from an older sha keeps the generic label. */
  run: AgentRun | undefined;
  /** The conversation the pane is showing; never offered as history. */
  currentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<ChatSession | null>(null);
  const others = sessions.filter((s) => s.id !== currentId);
  if (others.length === 0) return null;

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
      >
        <History className="size-3" />
        {others.length} earlier conversation{others.length === 1 ? "" : "s"} on
        this PR
        <span className="flex-1" />
        <span className="opacity-70">{open ? "hide" : "show"}</span>
      </button>
      {open ? (
        <div className="border-t border-border p-1 space-y-0.5">
          {others.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setReading(session)}
              className="w-full text-left rounded px-1.5 py-1 hover:bg-accent/40"
            >
              <div className="text-xs truncate">{scopeLabel(session, run)}</div>
              <div className="text-[10px] font-mono text-muted-foreground truncate">
                {shortSha(session.headSha)} · {session.messages.length} message
                {session.messages.length === 1 ? "" : "s"} ·{" "}
                {relativeAge(session.updatedAt)}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Read-only, always. A thread at another sha was about code that has
          since moved, so continuing it in place would attach new answers to a
          diff neither party was looking at — and its action chips were
          validated against a run that is gone. Reading it back is the whole
          ask; re-asking is a fresh question at this commit. */}
      <Dialog
        open={reading !== null}
        onOpenChange={(next) => {
          if (!next) setReading(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl w-[min(48rem,92vw)]">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {reading ? scopeLabel(reading, run) : ""}
            </DialogTitle>
          </DialogHeader>
          {reading ? (
            <>
              <div className="text-[10px] font-mono text-muted-foreground -mt-2">
                {shortSha(reading.headSha)} · {relativeAge(reading.updatedAt)} ·
                read-only
              </div>
              <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
                {/* The SAME renderer the live pane uses, with no handlers —
                    which is what makes the chips inert. Two copies of this JSX
                    had already drifted before either shipped. */}
                {reading.messages.map((message) => (
                  <ChatMessageView key={message.id} message={message} />
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setReading(null)}
                >
                  <X className="size-3 mr-1" />
                  Close
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
