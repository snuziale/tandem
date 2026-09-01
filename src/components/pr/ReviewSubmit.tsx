import { useEffect, useEffectEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  hasOpenAlertDialog,
  hasOpenDialog,
  isTypingTarget,
} from "../../keyboard/keyOwnership";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  cn,
  toast,
} from "@uipath/apollo-wind";
import { submitPr } from "../../api/prs";
import { isAgentAuthored } from "../../shared/review-types";
import type { PrId, ReviewVerdict } from "../../shared/review-types";
import { usePendingReview } from "../../hooks/usePendingReview";
import { MOD } from "../../keyboard/platform";
import { Shortcut } from "../common/Kbd";

type Props = {
  prId: PrId;
  headSha: string;
  /** An undismissed agent blocker — it refuses an APPROVE (M5). Passed as the
   * BARE fact: the verdict half of that rule is read off the draft here. */
  hasBlocker: boolean;
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

/**
 * Submitting the review: ONE button in the PR header, and a popover holding
 * everything the submit is made of — the staged tally, the verdict, the
 * summary prose.
 *
 * It replaces a full-width bottom tray. The tray spent a permanent row of the
 * screen on three controls you touch once at the very end of a review, and it
 * spent it on the axis the diff is shortest in. The CTA also belongs beside
 * the PR's own review state, not diagonally opposite it: the badge saying
 * where GitHub thinks the review stands and the button that moves it now read
 * as one group.
 *
 * The popover IS the confirmation — it names what will be posted and the click
 * inside it is the deliberate act, which is why there is no second dialog
 * behind it. Nothing here widens invariant §1: this is still the human
 * pressing the one button that writes to GitHub.
 */
export function ReviewSubmit({ prId, headSha, hasBlocker }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // The draft is read HERE rather than handed down from `PrDetailView`. Same
  // query key, so this is a second subscription and not a second fetch — and
  // it keeps `review` out of `PrHeader`'s props, which is what stops the whole
  // header subtree (state pill, branch copy, checks summary, review badge)
  // re-rendering on every file marked viewed and every comment staged.
  const { review, setVerdict, setSummary } = usePendingReview(prId, headSha);

  const comments = review?.comments ?? [];
  const agentCount = comments.filter(isAgentAuthored).length;
  const humanCount = comments.length - agentCount;
  const verdict = review?.verdict;

  const submit = useMutation({
    mutationFn: () =>
      submitPr(prId, {
        verdict: verdict ?? "COMMENT",
        summaryBody: review?.summaryBody ?? "",
      }),
    onSuccess: ({ url }) => {
      setOpen(false);
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

  // ONE derivation of "why can this not be submitted", so a disabled button is
  // always explained. It used to be three overlapping ones — `canSubmit`
  // folded "no verdict" together with "nothing to post" and `reason` re-derived
  // only the first half, so a picked verdict with an empty draft disabled the
  // button silently, inside a popover built to say why.
  const reason =
    verdict === "APPROVE" && hasBlocker
      ? "The agent found a blocker — dismiss it or pick another verdict to approve"
      : !verdict
        ? "Pick a verdict"
        : comments.length === 0 &&
            verdict === "COMMENT" &&
            !review?.summaryBody?.trim()
          ? "Stage a comment or write a summary"
          : null;
  const blocked = !!reason || submit.isPending;

  // ⌘↵ opens the popover, and once it is open it submits — the key means the
  // same thing at both steps, which is the only way it stays one shortcut.
  // `useEffectEvent` is how this screen binds a window listener ONCE while
  // still reading current state (`PrDetailView` does the same): the older
  // hand-rolled ref mirror needed a declaration order nothing enforced, and
  // the suppression it existed to avoid is what makes the React Compiler skip
  // a whole component.
  // A plain function, not an effect event: the summary box calls it straight
  // from its own onKeyDown, and an effect event may only be called from an
  // effect or another effect event. `onKey` below is the effect event, and it
  // is free to call this one — declared ABOVE it, per the compiler rule that a
  // closure capturing a later binding is silently left unmemoized.
  const trySubmit = () => {
    if (blocked) return;
    submit.mutate();
  };
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    // A typed ⌘↵ belongs to the box it was typed in — the summary textarea
    // binds its own, and the diff composer stages a comment with it.
    if (isTypingTarget(e.target) || hasOpenAlertDialog()) return;
    // PopoverContent is a role=dialog, so `hasOpenDialog` is true whenever
    // OURS is open. Only somebody else's modal should take the key.
    if (!open && hasOpenDialog()) return;
    e.preventDefault();
    if (open) trySubmit();
    else setOpen(true);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      onKey(e);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="3xs" className="shrink-0">
          Submit
          {/* With the tray gone this badge is the only thing on screen that
              says a draft exists at all, and a review you forgot you were
              half-way through is the failure mode. */}
          {comments.length > 0 ? (
            <span className="rounded-full bg-background/25 px-1.5 tabular-nums">
              {comments.length}
            </span>
          ) : null}
          <Shortcut keys={`${MOD}+↵`} className="opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(30rem,92vw)] p-0">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-medium">Submit review</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Posts ONE GitHub review as you. The author gets a single
            notification.
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-3 py-3">
          <div className="text-xs font-mono">
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
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={verdict ?? ""}
            onValueChange={(value) =>
              setVerdict(value === "" ? undefined : (value as ReviewVerdict))
            }
            aria-label="Review verdict"
            className="justify-start"
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
          <Textarea
            value={review?.summaryBody ?? ""}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => {
              // The window listener bails on typing targets, so the box has to
              // claim ⌘↵ for itself — same bargain the diff composer makes.
              if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
              e.preventDefault();
              trySubmit();
            }}
            placeholder="Review summary (optional)…"
            className="min-h-24 text-sm"
          />
          <div className="flex items-center gap-3">
            <Button
              size="xs"
              disabled={blocked}
              onClick={() => submit.mutate()}
            >
              {submit.isPending
                ? "Submitting…"
                : verdict
                  ? `Submit ${verdict.toLowerCase().replace("_", " ")}`
                  : "Submit"}
            </Button>
            {reason ? (
              <span className="text-[11px] text-muted-foreground">
                {reason}
              </span>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
