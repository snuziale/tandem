// SPIKE: submit a whole stack from the combined view. One verdict applies to
// every PR by default; "per PR" lets each take its own. Posts one GitHub
// review per PR — a review belongs to exactly one PR.
import { useState } from "react";
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
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  StackReview,
  StackSubmitResult,
} from "../../hooks/useStackReview";
import type { PrId, ReviewVerdict } from "../../shared/review-types";
import { VERDICTS } from "./verdicts";

export function StackSubmit({ stack }: { stack: StackReview }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<ReviewVerdict>("COMMENT");
  const [perPr, setPerPr] = useState<Record<PrId, ReviewVerdict>>({});
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<StackSubmitResult[] | null>(null);

  const verdictOf = (prId: PrId) => perPr[prId] ?? all;
  const total = stack.stagedByPr.reduce((n, s) => n + s.staged, 0);
  const mixed = stack.prs.some((pr) => verdictOf(pr.prId) !== all);
  // Same skip rule as submitAll: a Comment with nothing to say posts nothing.
  // Same guard rail as one PR: no APPROVE over an undismissed agent blocker.
  const blocked = stack.stagedByPr.filter(
    ({ pr, hasBlocker }) => hasBlocker && verdictOf(pr.prId) === "APPROVE",
  );
  const posting = stack.stagedByPr.filter(
    ({ pr, staged }) =>
      verdictOf(pr.prId) !== "COMMENT" || staged > 0 || summary.trim() !== "",
  ).length;

  const submit = async () => {
    setBusy(true);
    const verdicts: Record<PrId, ReviewVerdict> = {};
    for (const pr of stack.prs) verdicts[pr.prId] = verdictOf(pr.prId);
    const out = await stack.submitAll(verdicts, summary);
    setBusy(false);
    setResults(out);
    const failed = out.filter((r) => r.error).length;
    if (failed === 0)
      toast.success(
        `Posted ${out.length} review${out.length === 1 ? "" : "s"}`,
      );
    else toast.error(`${failed} of ${out.length} reviews failed`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="3xs" className="shrink-0">
          Submit stack
          {total > 0 ? (
            <span className="rounded-full bg-background/25 px-1.5 tabular-nums">
              {total}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(32rem,92vw)] p-0">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-medium">Submit stack</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Posts one GitHub review per PR with something to say ({posting} of{" "}
            {stack.prs.length}), each with its own comments.
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-3 py-3">
          <VerdictToggle
            value={mixed ? null : all}
            onChange={(v) => {
              setAll(v);
              setPerPr({});
            }}
            label={(l) => (l === "Comment" ? l : `${l} all`)}
          />
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-start"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            per PR{mixed ? " · mixed" : ""}
          </button>
          <ul className="flex flex-col gap-1.5">
            {stack.stagedByPr.map(({ pr, staged, hasBlocker }) => {
              const result = results?.find((r) => r.pr.prId === pr.prId);
              return (
                <li
                  key={pr.prId}
                  className="flex items-center gap-2 text-xs font-mono min-w-0"
                >
                  <span className="shrink-0">#{pr.number}</span>
                  <span className="truncate text-muted-foreground min-w-0 flex-1">
                    {pr.title}
                  </span>
                  {hasBlocker ? (
                    <span className="shrink-0 text-red-400">blocker</span>
                  ) : null}
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {staged} staged
                  </span>
                  {expanded ? (
                    <VerdictToggle
                      compact
                      value={verdictOf(pr.prId)}
                      onChange={(v) =>
                        setPerPr((p) => ({ ...p, [pr.prId]: v }))
                      }
                    />
                  ) : null}
                  {result ? (
                    <span
                      className={cn(
                        "shrink-0",
                        result.error ? "text-red-400" : "text-emerald-400",
                      )}
                      title={result.error}
                    >
                      {result.error ? "failed" : "posted"}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary, posted on every PR (optional)…"
            className="min-h-20 text-sm"
          />
          <div className="flex items-center gap-3">
            <Button
              size="xs"
              disabled={busy || posting === 0 || blocked.length > 0}
              onClick={() => void submit()}
            >
              {busy
                ? "Submitting…"
                : `Submit ${posting} review${posting === 1 ? "" : "s"}`}
            </Button>
            {blocked.length > 0 ? (
              <span className="text-[11px] text-red-400">
                {blocked.map((b) => `#${b.pr.number}`).join(", ")} has an open
                blocker — not approvable
              </span>
            ) : null}
            {stack.hiddenComments > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                incl. {stack.hiddenComments} not shown in the combined diff
              </span>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VerdictToggle({
  value,
  onChange,
  compact,
  label,
}: {
  value: ReviewVerdict | null;
  onChange: (v: ReviewVerdict) => void;
  compact?: boolean;
  label?: (l: string) => string;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={value ?? ""}
      onValueChange={(v) => {
        const hit = VERDICTS.find((x) => x.value === v);
        if (hit) onChange(hit.value);
      }}
      aria-label="Review verdict"
      className={cn("justify-start", compact && "shrink-0")}
    >
      {VERDICTS.map((v) => (
        <ToggleGroupItem
          key={v.value}
          value={v.value}
          title={v.label}
          aria-label={v.label}
          className={cn(
            compact ? "text-[10px] font-mono h-6 px-1.5" : "text-xs font-mono",
            value === v.value && v.activeClass,
          )}
        >
          {compact
            ? (COMPACT[v.value] ?? v.label)
            : (label?.(v.label) ?? v.label)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const COMPACT: Partial<Record<ReviewVerdict, string>> = {
  REQUEST_CHANGES: "Changes",
};
