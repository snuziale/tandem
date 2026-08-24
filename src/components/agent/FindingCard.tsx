import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Textarea, cn } from "@uipath/apollo-wind";
import { openChatFor } from "../../actions/chat";
import {
  acceptFinding,
  commentBodyOf,
  dismissFinding,
} from "../../actions/finding";
import type { Finding } from "../../shared/agent-types";
import type { PendingComment } from "../../shared/review-types";
import { useUiStore } from "../../state/uiStore";
import { Markdown } from "../common/Markdown";

type Props = {
  finding: Finding;
  addComment: (comment: Omit<PendingComment, "localId">) => void;
};

// A proposed agent finding, inline in the diff. Violet rail + AGENT label =
// machine-authored (the reserved provenance color, spec §1). Accepting stages
// it into the pending review; nothing reaches GitHub from here.
export function FindingCard({ finding, addComment }: Props) {
  const queryClient = useQueryClient();
  const editingFindingId = useUiStore((s) => s.editingFindingId);
  const setEditingFinding = useUiStore((s) => s.setEditingFinding);
  const focusedFindingId = useUiStore((s) => s.focusedFindingId);
  const editing = editingFindingId === finding.id;
  const focused = focusedFindingId === finding.id;
  const [draft, setDraft] = useState(() => commentBodyOf(finding));

  return (
    <div
      data-finding-card={finding.id}
      className={cn(
        "my-1 mx-2 rounded border bg-background",
        focused ? "border-[var(--tandem-agent)]" : "border-border",
      )}
      style={{ borderLeft: "2px solid var(--tandem-agent)" }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-mono">
          <span style={{ color: "var(--tandem-agent)" }}>● agent</span>
          <span className="text-muted-foreground">
            {finding.severity} · {finding.category}
          </span>
          <span className="flex-1" />
          <span className="text-muted-foreground">
            confidence {finding.confidence.toFixed(2)} ·{" "}
            {finding.evidence.length} evidence
          </span>
        </div>

        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditingFinding(null);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void acceptFinding(queryClient, finding, addComment, {
                  editedBody: draft,
                });
                setEditingFinding(null);
              }
            }}
            className="mt-2 min-h-20 text-sm font-mono"
          />
        ) : (
          <>
            <div className="text-sm font-semibold mt-1.5">{finding.title}</div>
            <Markdown className="mt-1">{finding.body}</Markdown>
          </>
        )}

        {finding.suggestion !== undefined && !editing ? (
          <pre className="mt-2 text-xs font-mono border border-border rounded p-2 overflow-x-auto bg-accent/30">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
              suggested change · lines{" "}
              {finding.startLine !== undefined ? `${finding.startLine}–` : ""}
              {finding.endLine}
            </div>
            {finding.suggestion}
          </pre>
        ) : null}

        <div className="flex items-center gap-1.5 mt-2">
          {editing ? (
            <>
              <Button
                size="2xs"
                onClick={() => {
                  void acceptFinding(queryClient, finding, addComment, {
                    editedBody: draft,
                  });
                  setEditingFinding(null);
                }}
              >
                Add edited to review
              </Button>
              <Button
                size="2xs"
                variant="ghost"
                onClick={() => setEditingFinding(null)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="2xs"
                variant="outline"
                style={{
                  borderColor: "var(--tandem-agent-dim)",
                  color: "var(--tandem-agent)",
                }}
                onClick={() =>
                  void acceptFinding(queryClient, finding, addComment)
                }
              >
                Add to review
              </Button>
              <Button
                size="2xs"
                variant="ghost"
                onClick={() => setEditingFinding(finding.id)}
              >
                Edit
              </Button>
              <Button
                size="2xs"
                variant="ghost"
                onClick={() => void dismissFinding(queryClient, finding)}
              >
                Dismiss
              </Button>
              {/* Push back, ask why, or have it reword this — the conversation
                  scopes itself to this finding. */}
              <Button
                size="2xs"
                variant="ghost"
                onClick={() => openChatFor(finding.id)}
              >
                Ask
              </Button>
              <span className="flex-1" />
              <span className="text-[10px] text-muted-foreground font-mono">
                y add · e edit · x dismiss · c ask
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
