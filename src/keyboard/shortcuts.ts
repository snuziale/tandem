import { ALT, MOD, SHIFT } from "./platform";

// Display registry for the `?` sheet. Manually synced with the dispatchers —
// useKeyboardNav.ts (queue) and PrDetailView's local handler (detail). Keys
// bound inside dialogs/composers (⌘↵ stage, Esc close) are documented here
// but dispatched by their owners. The command modifier is PRINTED per platform
// (keyboard/platform.ts) — every dispatcher already accepts meta or ctrl, so
// only the label changes.
//
// KEYS AND PROSE ARE SEPARATE FIELDS, and that is the point: a key renders as
// a <kbd> chip (components/common/Kbd.tsx) and a mouse gesture does not, so
// the sheet can never print "click a line" inside a key cap. An `action` never
// names a key either — an alternative spelling goes in `keys`, so every
// shortcut in the app is styled by the same component.
export type ShortcutItem = {
  /** Chords, `+`-joined within one; more than one = alternatives. */
  keys: string[];
  /** A pointer gesture, printed as prose beside the keys (or alone). */
  gesture?: string;
  action: string;
};

export type ShortcutGroup = {
  title: string;
  items: ShortcutItem[];
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Queue",
    items: [
      { keys: ["j", "k"], action: "next / previous pull request" },
      { keys: ["↵"], action: "open PR in Tandem" },
      { keys: ["o"], action: "open PR on GitHub" },
      { keys: ["a"], action: "one-click approve (blocked by agent blockers)" },
      { keys: [`${SHIFT}+A`], action: "approve anyway" },
      { keys: ["r"], action: "refresh queue" },
      { keys: ["s"], action: "show / hide the view breakdown" },
      { keys: ["esc"], action: "clear the breakdown filter" },
      { keys: ["/"], action: "edit the view query" },
    ],
  },
  {
    title: "PR detail",
    items: [
      { keys: ["esc"], action: "close the composer, then the find bar" },
      { keys: ["[", "]"], action: "previous / next file" },
      { keys: ["j", "k"], action: "next / previous agent finding" },
      { keys: ["y"], action: "add focused finding to review" },
      { keys: ["e"], action: "edit focused finding" },
      { keys: ["x"], action: "dismiss focused finding" },
      {
        keys: ["c"],
        action: "chat with the agent (about the focused finding)",
      },
      { keys: ["v"], action: "mark selected file viewed (first file if none)" },
      { keys: ["w"], action: "hide / show whitespace-only changes" },
      { keys: ["r"], action: "rerun agent" },
      { keys: ["a"], action: "set verdict: approve" },
      { keys: ["o"], action: "open PR on GitHub" },
      { keys: ["/", `${MOD}+F`], action: "find in diff" },
      { keys: ["n", `${SHIFT}+N`], action: "next / previous match" },
      { keys: [], gesture: "click a line", action: "comment there" },
      {
        keys: [],
        gesture: "drag line numbers",
        action: "comment on a range (or drag the gutter ⊕)",
      },
      {
        keys: [`${SHIFT}+click`],
        gesture: "a line number",
        action: "extend the range",
      },
      {
        keys: [`${ALT}+↑`, `${ALT}+↓`],
        action: "grow / shrink the range while composing",
      },
      {
        keys: [`${MOD}+↵`],
        action: "submit review (stages the comment while composing)",
      },
      { keys: ["↵", `${MOD}+↵`], action: "chat: send" },
      { keys: [`${SHIFT}+↵`], action: "chat: newline" },
    ],
  },
  {
    title: "Anywhere",
    items: [
      { keys: ["?"], action: "this sheet" },
      { keys: [`${MOD}+Q`], action: "quit (native app)" },
    ],
  },
];
