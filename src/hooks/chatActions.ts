// Opening the chat is three things at once — reveal the agent pane, expand the
// chat section, put the cursor in the composer — and it is triggered from the
// inline finding card, the pane, and the `c` key. One helper so all three
// behave identically.
import { useUiStore } from "../state/uiStore";

/** Scope follows the focused finding: pass a finding id to narrow, null for the PR. */
export function openChatFor(findingId: string | null): void {
  const ui = useUiStore.getState();
  ui.setFocusedFinding(findingId);
  ui.setPrAgentOpen(true);
  ui.setPrChatOpen(true);
  // The pane may be mounting this frame; focus after it paints.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      "[data-tandem-chat-input]",
    );
    input?.focus();
  });
}
