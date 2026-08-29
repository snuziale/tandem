// Opening the chat is three things at once — reveal the agent pane, make sure
// the conversation has height, put the cursor in the composer — and it is
// triggered from the inline finding card, the pane, and the `c` key. One
// helper so all three behave identically.
import { useUiStore } from "../state/uiStore";

/** Scope follows the focused finding: pass a finding id to narrow, null for the PR. */
export function openChatFor(findingId: string | null): void {
  const ui = useUiStore.getState();
  ui.setFocusedFinding(findingId);
  ui.setPrAgentOpen(true);
  // Only ever GROWS the conversation's share. Someone who has put the pane in
  // full-chat mode asked for that, and snapping back to the split every time
  // they press `c` would keep undoing it.
  if (ui.prAgentMode === "findings") ui.setPrAgentMode("split");
  // The pane may be mounting this frame; focus after it paints.
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      "[data-tandem-chat-input]",
    );
    input?.focus();
  });
}

/** findings → split → chat. Reveals the pane first: cycling a hidden pane
 * would change a mode nobody can see. */
export function cycleAgentMode(): void {
  const ui = useUiStore.getState();
  if (!ui.prAgentOpen) {
    ui.setPrAgentOpen(true);
    return;
  }
  ui.cyclePrAgentMode();
}
