// SPIKE (stack view): a slim row under a block several PRs of the stack edited
// in turn. Hover shows each version, oldest first. Neutral colour — this is
// provenance of HUMAN commits, not the agent's (violet is reserved, §3).
//
// A Popover opened on hover rather than apollo's HoverCard: HoverCard does not
// portal, so inside a diff annotation slot it was clipped by the card below.
import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@uipath/apollo-wind";
import { Layers } from "lucide-react";
import type { HistoryMark } from "../../shared/gh/stack";

const MAX_LINES = 12;

export function HistoryCard({
  mark,
  labels,
}: {
  mark: HistoryMark;
  labels: string[];
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A short grace period so the pointer can travel from the row into the card.
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  // Version i = what layer i wrote for THIS region: the next layer's `before`,
  // or the top layer's `after`. The first layer's `before` is the base.
  const base = mark.touches[0]?.before ?? [];
  const versions = mark.touches.map((t, i) => ({
    label: labels[i],
    lines: mark.touches[i + 1]?.before ?? t.after,
  }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          className="mx-2 my-0.5 inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
        >
          <Layers className="size-3" />
          {labels.join(" → ")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(36rem,90vw)] p-0"
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-2 border-b border-border text-xs font-medium">
          Edited by {labels.length} PRs in this stack
        </div>
        <div className="flex flex-col gap-2 px-3 py-2 max-h-80 overflow-y-auto">
          {base.length > 0 ? <Version label="base" lines={base} /> : null}
          {versions.map((v) => (
            <Version key={v.label} label={v.label} lines={v.lines} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Version({ label, lines }: { label: string; lines: string[] }) {
  const shown = lines.slice(0, MAX_LINES);
  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground mb-0.5">
        {label}
      </div>
      <pre className="text-[11px] leading-snug bg-muted rounded px-2 py-1 whitespace-pre-wrap break-all">
        {shown.length ? shown.join("\n") : "(removed)"}
        {lines.length > MAX_LINES
          ? `\n… ${lines.length - MAX_LINES} more lines`
          : ""}
      </pre>
    </div>
  );
}
