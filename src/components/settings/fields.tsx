// The settings screen's field vocabulary. Every section builds out of these,
// so a toggle in Pulse and a toggle in Agent are the same row with the same
// commit semantics rather than two hand-rolled ones that drift.
//
// BUTTONS follow four rules, and every section obeys them — a settings screen
// where the same job wears a different size on each page reads as eight
// screens rather than one:
//   1. A control that acts on the whole PANEL sits in that panel's `aside`
//      (top-right), `size="xs"`: primary = default variant, secondary =
//      outline, destructive = ghost + `text-destructive` + a Trash2 icon.
//   2. A FORM's submit sits at the bottom-left of the form it commits,
//      `size="xs"`, default variant (`FormActions` below) — and a destructive
//      action on what that form is EDITING sits at the far right of the same
//      row (Teams), rather than in the aside. Everywhere else the fields save
//      themselves, so there is no footer for it to belong to (Profiles).
//   3. An action on ONE ROW of a list is `size="2xs" variant="ghost"` and
//      lives at the row's right edge.
//   4. Labels are sentence case ("Add override", "Reset to default") — never
//      lowercase fragments, never Title Case.
//
// Commit rule, shared by all three text-ish fields: the draft is local, the
// commit happens on blur / Enter, and a value arriving from the server while
// the box is untouched replaces the draft (the `last` mirror). Settings save
// per field — there is no page-level Save button, which is why an uncommitted
// draft must never linger looking saved.
import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@uipath/apollo-wind";

/** The title block above a section's cards. Sections never render an
 * `<h1>`/`<header>` of their own — this is it, so spacing can't drift. */
export function SectionHeading({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h1 className="text-base font-semibold">{title}</h1>
      {children ? (
        <p className="text-xs text-muted-foreground leading-relaxed max-w-prose">
          {children}
        </p>
      ) : null}
    </div>
  );
}

/** A titled panel inside a section. Plain surface + hairline rather than
 * `Card`: the page is full width now, and a stack of elevated cards across
 * 1400px reads as a dashboard instead of a form. */
export function Panel({
  title,
  hint,
  aside,
  className,
  children,
}: {
  title?: string;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card/40 p-5 space-y-4",
        className,
      )}
    >
      {title ? (
        <div className="flex items-baseline gap-3">
          <div className="space-y-0.5 min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {hint ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed max-w-prose">
                {hint}
              </p>
            ) : null}
          </div>
          {aside ? <div className="ml-auto shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Field grid. Fields stay readable rather than stretching to the window: a
 * settings input 900px wide is harder to scan, not easier. */
export function FieldGrid({
  cols,
  children,
}: {
  cols?: 2 | 4;
  children: React.ReactNode;
}) {
  // Default in the body, never in the parameter — see the React Compiler
  // pitfall in CLAUDE.md.
  const columns = cols ?? 2;
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        columns === 4 ? "xl:grid-cols-4 max-w-5xl" : "xl:grid-cols-2 max-w-3xl",
      )}
    >
      {children}
    </div>
  );
}

/** A footnote inside a panel: the "why", or the consequence, in one or two
 * lines. Sections never emit loose paragraphs between panels — a sentence
 * floating on the page background has no owner. */
export function Note({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="flex gap-2 text-[11px] text-muted-foreground leading-relaxed max-w-prose">
      {Icon ? <Icon className="size-3.5 shrink-0 mt-px" /> : null}
      <span>{children}</span>
    </p>
  );
}

/** "Nothing here yet", in ONE size everywhere. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** The action row at the foot of a form (rule 2 above). */
export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 pt-1">{children}</div>;
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  /** A node, not a string: a hint that names a key renders it as a <kbd>. */
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 max-w-3xl">
      <div>
        <div className="text-sm">{label}</div>
        {hint ? (
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            {hint}
          </div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * The commit rule at the top of this file, in one place: a local draft, and a
 * value arriving from the server while the box is untouched replaces it. All
 * three text-ish fields below are this hook plus a commit rule of their own.
 */
const identity = (v: string) => v;

function useDraft<T>(value: T, show: (v: T) => string) {
  const [draft, setDraft] = useState(() => show(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(show(value));
  }
  return { draft, setDraft, reset: () => setDraft(show(value)) };
}

export function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const { draft, setDraft, reset } = useDraft(value, String);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== value)
      onCommit(parsed);
    else reset();
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-8 text-sm font-mono"
        inputMode="numeric"
      />
    </div>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  allowEmpty,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  allowEmpty?: boolean;
}) {
  const { draft, setDraft, reset } = useDraft(value, identity);
  const commit = () => {
    if ((draft.trim() || allowEmpty) && draft.trim() !== value)
      onCommit(draft.trim());
    else reset();
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-8 text-sm font-mono"
      />
    </div>
  );
}

/** Radix spells "nothing is selected" as `""` and therefore REFUSES it as an
 * item value — but `""` is exactly how a caller spells a real option that
 * means "no filter" ("All views, merged"). The swap is absorbed here so the
 * prop type stays a plain `T` and no caller has to know Radix exists. */
const EMPTY_VALUE = "__empty__";

/** A one-of-many field. Built on apollo's `Select` rather than a native
 * `<select>`: the platform control paints its own popup from the OS, so it was
 * the one field on the settings screen that ignored the app's theme, its type
 * scale and its dark mode. Sized `h-8` to match the boxes above it — the
 * library's trigger is `h-9`, a settings row and a half. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select
        value={value === "" ? EMPTY_VALUE : value}
        onValueChange={(v) => onChange((v === EMPTY_VALUE ? "" : v) as T)}
      >
        {/* The visible Label is not `htmlFor`-linked: the trigger is a
            `<button>`, which `<label for>` does not associate with. */}
        <SelectTrigger className="h-8 w-full px-2 text-sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value === "" ? EMPTY_VALUE : option.value}
              className="text-sm"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A prompt block, with its own reset-to-default. Empty means "the default",
 * never an empty prompt — a blank pass would silently degrade every run. */
export function PromptField({
  label,
  hint,
  value,
  defaultValue,
  onCommit,
}: {
  label: string;
  hint: string;
  value: string;
  defaultValue: string;
  onCommit: (value: string) => void;
}) {
  const { draft, setDraft } = useDraft(value, identity);
  const commit = () => {
    const next = draft.trim() ? draft : defaultValue;
    if (next !== value) onCommit(next);
    if (!draft.trim()) setDraft(defaultValue);
  };
  const isDefault = value === defaultValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
        <span className="flex-1" />
        {!isDefault ? (
          <>
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{ color: "var(--tandem-agent)" }}
            >
              customized
            </span>
            <Button
              size="2xs"
              variant="ghost"
              onClick={() => onCommit(defaultValue)}
            >
              Reset to default
            </Button>
          </>
        ) : null}
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        className="min-h-28 text-xs font-mono leading-relaxed"
      />
    </div>
  );
}
