import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Checkbox, Label, Textarea } from "@uipath/apollo-wind";
import type { ComposerTarget } from "../../state/uiStore";
import { spanOf } from "./annotations";

type Props = {
  target: ComposerTarget;
  /** The diff text under the range — the seed for a suggested change. */
  sourceText: string | null;
  /** Grow (-1) / shrink (+1) the range from the top. `sourceText` follows. */
  onExtendRange: (delta: -1 | 1) => void;
  onSubmit: (body: string, suggestion?: string) => void;
  onCancel: () => void;
};

// The line composer, opened by clicking a line or committing a line-number
// drag. ⌘↵ stages, Esc closes, ⌥↑/⌥↓ move the top of the range.
export function ComposerCard({
  target,
  sourceText,
  onExtendRange,
  onSubmit,
  onCancel,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // The box that last had focus INSIDE the card — body or suggestion. A drag
  // sends focus elsewhere (below); this is where it comes back to.
  const lastFocused = useRef<HTMLElement | null>(null);

  const [body, setBody] = useState("");
  const [isSuggestion, setIsSuggestion] = useState(false);
  // A suggestion IS a replacement for the anchored lines, so it starts as
  // those lines and FOLLOWS the range while nobody has typed in it — editing
  // beats retyping a whole block. Once touched it is the reader's text and
  // stops tracking; that is the whole of the state here.
  const [edited, setEdited] = useState<string | null>(null);
  const suggestion = edited ?? sourceText ?? "";

  /**
   * The card owns the keyboard, so it has to own FOCUS — and a line-number
   * drag takes it away. @pierre/diffs does not preventDefault that pointerdown,
   * so the browser focuses the nearest focusable ancestor, which is the
   * CodeView root (the library sets `tabIndex = -1` on it). That element is
   * our scroll container, so the arrow keys scroll the diff instead of moving
   * the range, and ⌘↵ and Esc stop working too. Dragging on an ALREADY-OPEN
   * composer is the case that bites: the card does not remount, so nothing
   * puts focus back on its own.
   *
   * Reclaim it whenever the range changes, but only when it actually left the
   * card — otherwise this would yank the caret out of the suggestion box on
   * every ⌥ arrow.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (!card || card.contains(document.activeElement)) return;
    const box = lastFocused.current ?? bodyRef.current;
    box?.focus({ preventScroll: true });
  }, [target.line, target.startLine]);

  const { start: first, end: last } = spanOf(target.startLine, target.line);
  const lineCount = last - first + 1;

  const canSubmit =
    body.trim().length > 0 || (isSuggestion && suggestion.length > 0);
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(body.trim(), isSuggestion ? suggestion : undefined);
  };
  // ⌥↑/⌥↓ rather than ⇧↑/⇧↓: shift-arrow selects text in a textarea, and a
  // comment box may not quietly lose that. Bound on the CARD so it works from
  // the suggestion box too — that is the box the re-seed exists for.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      onExtendRange(e.key === "ArrowUp" ? -1 : 1);
    }
  };

  return (
    <div
      ref={cardRef}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        lastFocused.current = e.target as HTMLElement;
      }}
      className="my-1 mx-2 rounded border border-primary/40 bg-background p-3 space-y-2"
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
        Comment on {target.path.split("/").pop()}:
        {lineCount > 1 ? `${first}–${last}` : last}
        {target.side === "LEFT" ? " (old side)" : ""}
        {lineCount > 1 ? ` · ${lineCount} lines` : ""}
      </div>
      <Textarea
        ref={bodyRef}
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment…"
        className="min-h-16 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="composer-suggestion"
          checked={isSuggestion}
          onCheckedChange={(v) => setIsSuggestion(v === true)}
          className="size-3.5"
        />
        <Label
          htmlFor="composer-suggestion"
          className="text-xs text-muted-foreground"
        >
          Include a suggested change (exact replacement for{" "}
          {lineCount > 1 ? `these ${lineCount} lines` : "this line"})
        </Label>
      </div>
      {isSuggestion ? (
        <Textarea
          value={suggestion}
          onChange={(e) => setEdited(e.target.value)}
          placeholder="Replacement text for the anchored line(s)…"
          className="min-h-12 text-sm font-mono"
          spellCheck={false}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">
          drag the line numbers, or ⌥↑ / ⌥↓, for a range
        </span>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="xs" disabled={!canSubmit} onClick={submit}>
            Add to review
          </Button>
        </div>
      </div>
    </div>
  );
}
