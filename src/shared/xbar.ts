// The menu-bar feed: Tandem's queue rendered as an xbar/SwiftBar plugin.
//
// Why this lives in the app instead of in a script beside it: the thing an
// xbar PR plugin actually needs is a token, a team, a staleness threshold
// and a definition of "needs me" — all four of which Tandem already owns and
// the user already configured. Serving the menu text turns a 250-line Python
// plugin with its own .env and its own copy of the team list into
//
//     #!/bin/sh
//     curl -s http://127.0.0.1:5274/api/pulse.xbar
//
// and the menu bar inherits every setting the app has, including the pulse
// rules, so the glanceable surface and the app can never disagree.
//
// Pure: rows in, plugin text out. Format reference: an item is
// `text | key=value ...`, a leading `--` nests it one level (a submenu), and a
// line of `---` is a separator. The first line before the first `---` is what
// shows IN the menu bar.
import {
  groupPullRequests,
  idleDaysOf,
  isAutoMerging,
  pulseCounts,
  pulseStateOf,
  type GroupDim,
  type PulseOptions,
  type PulseState,
} from "./pulse";
import type { PullRequest } from "./review-types";

/**
 * Emoji, and ONLY here. The app draws these states with lucide icons — an
 * emoji renders differently on every machine and can't take a theme color.
 * A menu-bar plugin is plain text, though: there is no SVG to hand xbar, so
 * this is the one surface where a glyph is the only glyph available.
 */
const PULSE_GLYPHS: Record<PulseState, string> = {
  "blocked-on-you": "👀",
  rotting: "🕰️",
  "blocked-on-them": "⛔️",
  ready: "✅",
  moving: "🚚",
};
const GROUP_GLYPH_FALLBACK = "•";

/** Mid-tone hexes, chosen to stay legible on BOTH a light and a dark menu bar
 * — xbar renders one color for both, so a near-black title (what the original
 * script used) disappears in dark mode. */
const STATE_COLOR: Record<string, string> = {
  "blocked-on-you": "#d97706",
  rotting: "#dc2626",
  "blocked-on-them": "#9ca3af",
  ready: "#16a34a",
  moving: "#9ca3af",
};
const HEADING_COLOR = "#6b7280";

export type XbarParams = {
  href?: string;
  color?: string;
  size?: number;
  font?: string;
  refresh?: boolean;
};

/** `|` separates an item's text from its parameters, so it can never survive
 * inside the text; newlines would end the item entirely. */
export function xbarEscape(text: string): string {
  return text
    .replaceAll("|", "-")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function xbarLine(
  text: string,
  params: XbarParams = {},
  depth = 0,
): string {
  const parts: string[] = [];
  if (params.href) parts.push(`href=${params.href}`);
  if (params.color) parts.push(`color=${params.color}`);
  if (params.size !== undefined) parts.push(`size=${params.size}`);
  if (params.font) parts.push(`font=${params.font}`);
  if (params.refresh) parts.push("refresh=true");
  const body = `${"--".repeat(depth)}${xbarEscape(text)}`;
  return parts.length ? `${body} | ${parts.join(" ")}` : body;
}

export type PulseMenuOptions = PulseOptions & {
  groupBy?: GroupDim;
  /** Where "Open Tandem" points — the local server's own origin. */
  appUrl?: string;
  /** Named in the footer so a multi-view menu says what it is showing. */
  sourceLabel?: string;
};

/** `2 ✅ · 3 💬 · 1 ⛔️ · 🦾` — the xbar script's glyph vocabulary, kept
 * because it is genuinely good: every mark is a count of a thing that
 * happened, and none of them need a legend. */
function signalsOf(pr: PullRequest): string {
  const parts: string[] = [];
  if (pr.approvalCount > 0) parts.push(`${pr.approvalCount} ✅`);
  if (pr.commentCount + pr.threadCount > 0)
    parts.push(`${pr.commentCount + pr.threadCount} 💬`);
  if (pr.changesRequestedCount > 0)
    parts.push(`${pr.changesRequestedCount} ⛔️`);
  if (pr.checkRollup === "FAILURE") parts.push("🔴");
  if (isAutoMerging(pr)) parts.push("🦾");
  if (pr.isDraft) parts.push("🚧");
  return parts.join(" ");
}

function ageOf(pr: PullRequest, now: number): string {
  const days = idleDaysOf(pr, now);
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  return `${Math.round(days)}d`;
}

function rowLine(
  pr: PullRequest,
  opts: PulseMenuOptions,
  depth: number,
): string {
  const state = pulseStateOf(pr, opts);
  const text = `[${pr.author}] ${pr.repo}#${pr.number} — ${pr.title}  ·  ${
    signalsOf(pr) || "—"
  }  ·  ${ageOf(pr, opts.now)}`;
  return xbarLine(
    text,
    { href: pr.url, size: 12, color: STATE_COLOR[state] },
    depth,
  );
}

/**
 * The whole plugin body.
 *
 * The menu-bar line leads with what needs YOU, because that is the only number
 * worth interrupting someone with; the total follows it. Groups render flat
 * (a heading and its rows) so the important ones are readable without a click
 * — except `moving`, which is by definition the work nobody is waiting on and
 * folds into a submenu, exactly as the original folded other people's drafts.
 */
export function renderPulseMenu(
  rows: readonly PullRequest[],
  opts: PulseMenuOptions,
): string {
  const groupBy = opts.groupBy ?? "pulse";
  const counts = pulseCounts(rows, opts);
  const lines: string[] = [];

  const needsYou = counts["blocked-on-you"];
  const rotting = counts.rotting;
  const head = [
    needsYou > 0 ? `👀 ${needsYou}` : null,
    rotting > 0 ? `🕰️ ${rotting}` : null,
    `${rows.length} 🧑‍💻`,
  ]
    .filter(Boolean)
    .join(" · ");
  lines.push(head);
  lines.push("---");

  if (rows.length === 0) {
    lines.push(xbarLine("Nothing open", { color: HEADING_COLOR, size: 12 }));
  }

  for (const group of groupPullRequests(rows, groupBy, opts)) {
    const glyph =
      groupBy === "pulse"
        ? (PULSE_GLYPHS[group.key as PulseState] ?? GROUP_GLYPH_FALLBACK)
        : GROUP_GLYPH_FALLBACK;
    const collapsed = groupBy === "pulse" && group.key === "moving";
    lines.push(
      xbarLine(`${glyph} ${group.label.toUpperCase()} · ${group.rows.length}`, {
        color: HEADING_COLOR,
        size: 11,
      }),
    );
    for (const pr of group.rows)
      lines.push(rowLine(pr, opts, collapsed ? 1 : 0));
    lines.push("---");
  }

  if (opts.sourceLabel)
    lines.push(xbarLine(opts.sourceLabel, { color: HEADING_COLOR, size: 11 }));
  if (opts.appUrl)
    lines.push(xbarLine("Open Tandem", { href: opts.appUrl, size: 12 }));
  lines.push(xbarLine("Refresh", { refresh: true, size: 12 }));

  return `${lines.join("\n")}\n`;
}
