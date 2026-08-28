import { cn } from "@uipath/apollo-wind";
import { IS_MAC } from "../../keyboard/platform";

/**
 * The ONE way a key is printed. Every surface that names a shortcut — the `?`
 * sheet, tooltips, button affordances, the settings hints, a toast — renders
 * through here, because a shortcut printed as bare prose ("press r") reads as
 * a sentence, not as something you can hit, and four hand-rolled spellings of
 * the same chip is how the app stops looking like one app.
 *
 * The chip is drawn in `currentColor`, never in a named token: it appears on
 * the page background AND inside a tooltip's inverted surface, and a fixed
 * border/text color is legible on exactly one of those. Inheriting means the
 * caller's context decides, and there is nothing to keep in sync.
 *
 * Sized in `em`, so it tracks whatever type it sits in (11px meta rows,
 * 10px hints, 14px sheet rows) without a size prop.
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center align-baseline shrink-0",
        "min-w-[1.5em] px-[0.35em] py-[0.15em] rounded-[4px]",
        "font-mono text-[0.85em] leading-[1.4] font-medium whitespace-nowrap",
        // Heavier bottom edge: the one bit of key-cap depth worth keeping at
        // this size — a full shadow turns to mud under 12px.
        "border border-b-2 border-current/25 bg-current/8",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * A chord (`"⌘+↵"`) or a set of alternatives (`["j", "k"]`), printed as chips.
 *
 * `+` separates keys pressed TOGETHER and is a display convention, not part of
 * the key: macOS sets modifier glyphs solid (⌘↵), everywhere else spells them
 * with a plus (Ctrl+Enter). Hence `MOD`/`ALT`/`SHIFT` are bare in
 * `keyboard/platform.ts` and the joiner is decided here, once.
 *
 * Alternatives are separated by a muted `/` — "either of these", the same
 * meaning the `?` sheet's `j / k` rows always had.
 */
export function Shortcut({
  keys,
  className,
}: {
  keys: string | string[];
  className?: string;
}) {
  const chords = Array.isArray(keys) ? keys : [keys];
  return (
    <span
      className={cn("inline-flex items-center gap-1 align-baseline", className)}
    >
      {chords.map((chord, i) => (
        <span key={chord} className="inline-flex items-center gap-0.5">
          {i > 0 ? (
            <span className="opacity-40 mr-0.5 font-mono text-[0.85em]">/</span>
          ) : null}
          {chord.split("+").map((key, k) => (
            <span key={key} className="inline-flex items-center gap-0.5">
              {k > 0 && !IS_MAC ? (
                <span className="opacity-40 font-mono text-[0.8em]">+</span>
              ) : null}
              <Kbd>{key}</Kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * A shortcut plus its prose. For the few callers that can only pass a NODE and
 * have no JSX of their own — a sonner toast's `description`, built inside a
 * keyboard dispatcher (`createElement(ShortcutHint, …)`).
 */
export function ShortcutHint({
  keys,
  text,
}: {
  keys: string | string[];
  text: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <Shortcut keys={keys} />
      <span>{text}</span>
    </span>
  );
}
