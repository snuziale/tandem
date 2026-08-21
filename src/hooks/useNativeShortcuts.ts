import { useEffect } from 'react';

// webview-bun (macOS WKWebView, Windows WebView2) ships without a native
// application menu, so Cmd+V / Cmd+C / Cmd+X / Cmd+A aren't delivered to
// focused text inputs by default. This hook installs a single capture-phase
// keydown listener that handles those four shortcuts manually for native
// <input> and <textarea> elements. Real browsers (pnpm dev) follow the same
// path — `preventDefault()` blocks the browser's own paste so we don't
// double-insert.
export function useNativeShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = document.activeElement;
      if (!isEditableNativeField(el)) return;

      switch (e.key.toLowerCase()) {
        case 'v':
          e.preventDefault();
          void paste(el);
          return;
        case 'c':
          e.preventDefault();
          void copySelection(el);
          return;
        case 'x':
          if (e.shiftKey) return;
          e.preventDefault();
          void cut(el);
          return;
        case 'a':
          e.preventDefault();
          selectAll(el);
          return;
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);
}

type EditableField = HTMLInputElement | HTMLTextAreaElement;

function isEditableNativeField(el: Element | null): el is EditableField {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false;
    // Only types that accept text editing. Skip checkbox/radio/file/etc.
    return /^(text|search|email|url|tel|password|number|)$/.test(el.type);
  }
  return false;
}

async function paste(el: EditableField): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    insertText(el, text);
  } catch {
    // permission denied or no clipboard data — silently ignore
  }
}

// Copy the field's current selection to the clipboard. Returns true only when
// a non-empty selection was actually written.
async function copySelection(el: EditableField): Promise<boolean> {
  const { selectionStart, selectionEnd, value } = el;
  if (selectionStart == null || selectionEnd == null || selectionStart === selectionEnd) return false;
  try {
    await navigator.clipboard.writeText(value.substring(selectionStart, selectionEnd));
    return true;
  } catch {
    // permission denied — leave the field untouched
    return false;
  }
}

async function cut(el: EditableField): Promise<void> {
  if (await copySelection(el)) insertText(el, '');
}

function selectAll(el: EditableField): void {
  el.select();
}

// Insert at the current cursor / replace the current selection, preserving
// undo history. Falls back to direct value mutation if execCommand is gone.
function insertText(el: EditableField, text: string): void {
  el.focus();
  if (document.execCommand) {
    const ok = document.execCommand('insertText', false, text);
    if (ok) return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  el.value = next;
  const cursor = start + text.length;
  el.setSelectionRange(cursor, cursor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
