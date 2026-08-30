// One lucide icon per pulse state, and per row signal.
//
// Deliberately NOT emoji, even though the menu-bar feed uses them: an emoji
// renders differently on every machine, sits on its own baseline, and cannot
// take a theme color — so it would break the one rule these marks live by,
// which is that the color IS the status token. shared/xbar.ts keeps a glyph
// table because a menu-bar plugin is plain text and has no other option.
import {
  Activity,
  Ban,
  Check,
  CircleCheck,
  Eye,
  GitMerge,
  Hourglass,
  MessageSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { PulseReason, PulseState } from "../../shared/pulse";

export const PULSE_ICON: Record<PulseState, LucideIcon> = {
  "blocked-on-you": Eye,
  rotting: Hourglass,
  "blocked-on-them": Ban,
  ready: CircleCheck,
  moving: Activity,
};

/**
 * `blocked-on-you` has two entrances (shared/pulse.ts `pulseOf`) and the eye
 * only fits one of them: on your OWN red-checked PR it says you owe a review
 * of your own work. A single ROW knows which door it came in by, so it draws
 * the reason; the header pill and the drawer are counting a bucket that mixes
 * both, so they keep the eye.
 *
 * The COLOR does not fork — it is the same court and the same urgency, and
 * pulse colors are the reserved status tokens, not a per-reason palette.
 */
export const PULSE_REASON_ICON: Record<PulseReason, LucideIcon> = {
  "your-review": Eye,
  "your-branch": Wrench,
};

/** Row signals: an approval, a change request, a conversation, auto-merge. */
export const SIGNAL_ICON = {
  approvals: Check,
  changes: Ban,
  comments: MessageSquare,
  automerge: GitMerge,
} as const satisfies Record<string, LucideIcon>;

/**
 * One color per pulse state, and the ONLY definition of it.
 *
 * Status tokens, not a new palette: this is the same JOB as the checks and
 * review columns (a small closed set of states, each with a written label), so
 * it wears the same reserved colors. "Moving" and "blocked on them" both read
 * as muted on purpose — neither is yours, and the eye should slide off them.
 *
 * The queue cell, the header pill and the drawer all read this. They had three
 * copies and had already drifted; the drawer still overrides `moving`, but it
 * now does so out loud, for a stated reason.
 */
export const PULSE_COLOR: Record<PulseState, string> = {
  "blocked-on-you": "var(--warning)",
  rotting: "var(--error)",
  "blocked-on-them": "var(--foreground-muted)",
  ready: "var(--success)",
  moving: "var(--foreground-muted)",
};
