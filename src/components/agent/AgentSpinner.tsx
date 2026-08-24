import { cn } from "@uipath/apollo-wind";

/**
 * The violet in-progress ring for agent work, at text scale.
 *
 * Apollo's `<Spinner>` cannot be used this small: its `className` lands on the
 * WRAPPER div while the inner Loader2 icon is sized by the `size` variant alone
 * (`sm` 16px, default 24px) — so `<Spinner className="size-3" />` renders a 24px
 * icon inside a 12px box, which is what made the run timeline's rows overlap.
 * A bordered span is exact at any size, and it can wear `--tandem-agent`, which
 * the variants (`default`/`primary`/`foreground`) cannot.
 */
export function AgentSpinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="working"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full border border-current border-t-transparent motion-safe:animate-spin",
        className,
      )}
      style={{ color: "var(--tandem-agent)" }}
    />
  );
}
