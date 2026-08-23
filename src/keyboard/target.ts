// Who owns the keystroke. Shared by the global shortcut handler and by dialogs
// that bind their own keys, so "skip while typing" has one definition — a second
// copy drifts the moment one of them learns about a new editable element.

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const OPEN_DIALOG = '[role="dialog"][data-state="open"]';
export const OPEN_ALERT_DIALOG = '[role="alertdialog"][data-state="open"]';

/** True when the event landed in a field the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * True when any modal is open. `useKeyboardNav` bails on this — screen-scoped
 * shortcuts must not fire behind a modal — which is why a dialog that wants its
 * own keys has to bind them itself.
 */
export function hasOpenDialog(): boolean {
  return !!document.querySelector(`${OPEN_DIALOG}, ${OPEN_ALERT_DIALOG}`);
}

/** True when a confirm-style dialog is stacked on top and should own the keys. */
export function hasOpenAlertDialog(): boolean {
  return !!document.querySelector(OPEN_ALERT_DIALOG);
}
