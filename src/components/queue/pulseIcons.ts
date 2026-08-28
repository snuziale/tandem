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
  type LucideIcon,
} from "lucide-react";
import type { PulseState } from "../../shared/pulse";

export const PULSE_ICON: Record<PulseState, LucideIcon> = {
  "blocked-on-you": Eye,
  rotting: Hourglass,
  "blocked-on-them": Ban,
  ready: CircleCheck,
  moving: Activity,
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
