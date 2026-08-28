// Display registry for the `?` sheet. Manually synced with the dispatchers —
// useKeyboardNav.ts (queue) and PrDetailView's local handler (detail). Keys
// bound inside dialogs/composers (⌘↵ stage, Esc close) are documented here
// but dispatched by their owners.
export type ShortcutGroup = {
  title: string;
  items: Array<[keys: string, action: string]>;
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Queue",
    items: [
      ["j / k", "next / previous pull request"],
      ["Enter", "open PR in Tandem"],
      ["o", "open PR on GitHub"],
      ["a", "one-click approve (blocked by agent blockers)"],
      ["shift+A", "approve anyway"],
      ["r", "refresh queue"],
      ["s", "show / hide the view breakdown"],
      ["esc", "clear the breakdown filter"],
      ["/", "edit the view query"],
    ],
  },
  {
    title: "PR detail",
    items: [
      ["esc", "close the composer"],
      ["[ / ]", "previous / next file"],
      ["j / k", "next / previous agent finding"],
      ["y", "add focused finding to review"],
      ["e", "edit focused finding"],
      ["x", "dismiss focused finding"],
      ["c", "chat with the agent (about the focused finding)"],
      ["v", "mark selected file viewed"],
      ["w", "hide / show whitespace-only changes"],
      ["r", "rerun agent"],
      ["a", "set verdict: approve"],
      ["o", "open PR on GitHub"],
      ["click a line", "comment there"],
      ["drag line numbers", "comment on a range (or drag the gutter ⊕)"],
      ["shift+click a number", "extend the range"],
      ["⌥↑ / ⌥↓", "grow / shrink the range while composing"],
      ["⌘↵", "submit review (stages the comment while composing)"],
      ["↵ / ⇧↵", "chat: send · newline (⌘↵ also sends)"],
    ],
  },
  {
    title: "Anywhere",
    items: [
      ["?", "this sheet"],
      ["⌘Q", "quit (native app)"],
    ],
  },
];
