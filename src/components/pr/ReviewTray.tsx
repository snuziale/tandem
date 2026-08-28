import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hasOpenDialog, isTypingTarget } from "../../keyboard/keyOwnership";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  cn,
  toast,
} from "@uipath/apollo-wind";
import { submitPr } from "../../api/prs";
import type {
  PendingReview,
  PrId,
  ReviewVerdict,
} from "../../shared/review-types";
import { MOD } from "../../keyboard/platform";
import { Shortcut } from "../common/Kbd";

type Props = {
  prId: PrId;
  review: PendingReview | null;
  onVerdict: (verdict: ReviewVerdict | undefined) => void;
  onSummary: (summary: string) => void;
  /** Submit blocked (e.g. agent found a blocker and verdict is APPROVE — M5). */
  submitDisabledReason?: string;
};

const VERDICTS: Array<{
  value: ReviewVerdict;
  label: string;
  activeClass: string;
}> = [
  {
    value: "APPROVE",
    label: "Approve",
    activeClass: "border-emerald-400/60 text-emerald-400",
  },
  {
    value: "COMMENT",
    label: "Comment",
    activeClass: "border-border text-foreground",
  },
  {
    value: "REQUEST_CHANGES",
    label: "Request changes",
    activeClass: "border-red-400/60 text-red-400",
  },
];

export function ReviewTray({
  prId,
  review,
  onVerdict,
  onSummary,
  submitDisabledReason,
}: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const comments = review?.comments ?? [];
  const agentCount = comments.filter((c) => c.findingId !== undefined).length;
  const humanCount = comments.length - agentCount;
  const verdict = review?.verdict;

  const submit = useMutation({
    mutationFn: () =>
      submitPr(prId, {
        verdict: verdict ?? "COMMENT",
        summaryBody: review?.summaryBody ?? "",
      }),
    onSuccess: ({ url }) => {
      setConfirmOpen(false);
      toast.success("Review submitted", { description: url });
      queryClient.setQueryData(["review", prId], null);
      queryClient.invalidateQueries({ queryKey: ["review", prId] });
      queryClient.invalidateQueries({ queryKey: ["pr", prId] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => {
      toast.error("Submit failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    },
  });

  const canSubmit =
    !!verdict &&
    (comments.length > 0 ||
      verdict !== "COMMENT" ||
      !!review?.summaryBody?.trim());

  // ⌘↵ opens the confirm dialog (never fires while typing — the composer's
  // own ⌘↵ stages a comment instead).
  const keyState = useRef({ canSubmit, submitDisabledReason });
  useEffect(() => {
    keyState.current = { canSubmit, submitDisabledReason };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (isTypingTarget(e.target) || hasOpenDialog()) return;
      const { canSubmit, submitDisabledReason } = keyState.current;
      if (!canSubmit || submitDisabledReason) return;
      e.preventDefault();
      setConfirmOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="border-t border-border px-4 py-2 flex items-center gap-3 shrink-0 bg-background">
        <span className="text-xs font-mono">
          <span className="font-semibold">{comments.length}</span>{" "}
          <span className="text-muted-foreground">
            comment{comments.length === 1 ? "" : "s"} staged
            {comments.length > 0 ? (
              <>
                {" "}
                · {humanCount} yours
                {agentCount > 0 ? (
                  <span style={{ color: "var(--tandem-agent)" }}>
                    {" "}
                    · {agentCount} agent
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
        </span>
        <span className="flex-1" />
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={verdict ?? ""}
          onValueChange={(value) =>
            onVerdict(value === "" ? undefined : (value as ReviewVerdict))
          }
          aria-label="Review verdict"
        >
          {VERDICTS.map((v) => (
            <ToggleGroupItem
              key={v.value}
              value={v.value}
              className={cn(
                "text-xs font-mono",
                verdict === v.value && v.activeClass,
              )}
            >
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="xs"
          disabled={!canSubmit || !!submitDisabledReason}
          title={
            submitDisabledReason ??
            (!verdict ? "Pick a verdict first" : undefined)
          }
          onClick={() => setConfirmOpen(true)}
        >
          Submit review
          <Shortcut keys={`${MOD}+↵`} className="ml-1.5 opacity-70" />
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit review</DialogTitle>
            <DialogDescription>
              Posts ONE GitHub review as you — {comments.length} comment
              {comments.length === 1 ? "" : "s"} + verdict{" "}
              <span className="font-mono">{verdict}</span>. The author gets a
              single notification.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={review?.summaryBody ?? ""}
            onChange={(e) => onSummary(e.target.value)}
            placeholder="Review summary (optional)…"
            className="min-h-20 text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending
                ? "Submitting…"
                : `Submit ${verdict?.toLowerCase().replace("_", " ")}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
