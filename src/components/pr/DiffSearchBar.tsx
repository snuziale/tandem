import {
  Button,
  Input,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@uipath/apollo-wind";
import { ChevronDown, ChevronUp, List, Search, X } from "lucide-react";
import { Shortcut } from "../common/Kbd";
import type { DiffSearchOptions, DiffSearchResult } from "./diffSearch";
import { DiffSearchResults } from "./DiffSearchResults";

type Props = {
  term: string;
  onTermChange: (term: string) => void;
  options: DiffSearchOptions;
  onOptionsChange: (options: DiffSearchOptions) => void;
  result: DiffSearchResult;
  /** -1 until the reader asks to jump — see the no-jump-while-typing note. */
  activeIndex: number;
  onStep: (delta: 1 | -1) => void;
  onJump: (index: number) => void;
  listOpen: boolean;
  onListOpenChange: (open: boolean) => void;
  onClose: () => void;
  /** Owned by PrDetailView so ⌘F on an already-open bar can re-focus it. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Files in the diff. Shown before a term is typed, as the scope the count
   * that replaces it will be measured against. */
  fileCount: number;
  hideWhitespace: boolean;
};

// The `ws` toggle's recipe: pressing changes the fill only, so the control
// keeps its width, and the state is styled off aria-pressed because a tooltip
// trigger owns data-state on its child.
const TOGGLE_CLASS =
  "h-6 px-1.5 min-w-0 font-mono text-[11px] aria-pressed:bg-foreground/10 aria-pressed:border-foreground/40 aria-pressed:text-foreground future:aria-pressed:text-foreground";

function OptionToggle({
  label,
  title,
  pressed,
  onPressedChange,
}: {
  label: string;
  title: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="xs"
          variant="outline"
          pressed={pressed}
          onPressedChange={onPressedChange}
          aria-label={title}
          className={TOGGLE_CLASS}
        >
          {label}
        </Toggle>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{title}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{label}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/**
 * Find in diff. It exists because the browser's own find can only see what
 * CodeView has rendered — a folded, viewed or off-screen file is simply not in
 * the DOM — so the count here is computed from the patches instead
 * (`diffSearch.ts`).
 *
 * It does NOT jump as you type. Typing that scrolled the pane and force-
 * expanded whichever file matched first would move the reader's place on every
 * keystroke; the count and the results list answer "is it in here?" instantly,
 * and ↵ is what commits to going there.
 */
export function DiffSearchBar({
  term,
  onTermChange,
  options,
  onOptionsChange,
  result,
  activeIndex,
  onStep,
  onJump,
  listOpen,
  onListOpenChange,
  onClose,
  inputRef,
  fileCount,
  hideWhitespace,
}: Props) {
  const { hits, truncated, error } = result;
  const set = (patch: Partial<DiffSearchOptions>) =>
    onOptionsChange({ ...options, ...patch });

  const fileHits = new Set(hits.map((h) => h.path)).size;
  const status = error
    ? error
    : term === ""
      ? `${fileCount} files`
      : hits.length === 0
        ? "no matches"
        : `${activeIndex >= 0 ? `${activeIndex + 1}/` : ""}${hits.length}${
            truncated ? "+" : ""
          } · ${fileHits} files`;

  return (
    <div className="rounded-md border border-border bg-background shadow-lg">
      <div className="flex items-center gap-1.5 p-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          ref={inputRef}
          size="xs"
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
          onKeyDown={(e) => {
            // The box owns ↵/⇧↵ and esc while it has focus — the detail
            // dispatcher bails on a typing target, by design.
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder="Find in diff"
          spellCheck={false}
          className="h-6 text-xs font-mono flex-1 min-w-0"
        />
        <span
          className={`shrink-0 text-[11px] font-mono tabular-nums text-right ${
            error
              ? "text-destructive truncate max-w-[12rem]"
              : "text-muted-foreground"
          }`}
          title={error ?? undefined}
        >
          {status}
        </span>
        <IconButton
          label="Previous match"
          disabled={hits.length === 0}
          onClick={() => onStep(-1)}
        >
          <ChevronUp />
        </IconButton>
        <IconButton
          label="Next match"
          disabled={hits.length === 0}
          onClick={() => onStep(1)}
        >
          <ChevronDown />
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="xs"
              pressed={listOpen}
              onPressedChange={onListOpenChange}
              aria-label="Show every match"
              className="h-6 w-6 p-0 shrink-0 aria-pressed:bg-foreground/10"
            >
              <List className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Show every match</TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <span className="w-px h-5 bg-border shrink-0" />
        <OptionToggle
          label="Aa"
          title="Match case"
          pressed={options.caseSensitive}
          onPressedChange={(caseSensitive) => set({ caseSensitive })}
        />
        <OptionToggle
          label="ab"
          title="Whole word"
          pressed={options.wholeWord}
          onPressedChange={(wholeWord) => set({ wholeWord })}
        />
        <OptionToggle
          label=".*"
          title="Regular expression"
          pressed={options.regex}
          onPressedChange={(regex) => set({ regex })}
        />
        <OptionToggle
          label="+"
          title="Added lines only"
          pressed={options.additionsOnly}
          onPressedChange={(additionsOnly) => set({ additionsOnly })}
        />
        <span className="w-px h-5 bg-border shrink-0" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="2xs"
              icon
              variant="ghost"
              aria-label="Close find"
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>
              Close find
              <Shortcut keys="esc" className="ml-1.5" />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
      {listOpen && hits.length > 0 ? (
        <DiffSearchResults
          hits={hits}
          activeIndex={activeIndex}
          onJump={onJump}
          truncated={truncated}
          hideWhitespace={hideWhitespace}
        />
      ) : null}
    </div>
  );
}
