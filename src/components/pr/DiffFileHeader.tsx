import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox, cn } from "@uipath/apollo-wind";
import type { FileChange } from "../../shared/review-types";

const STATUS_LABEL: Partial<Record<FileChange["status"], string>> = {
  added: "added",
  removed: "deleted",
  renamed: "renamed",
  copied: "copied",
};

type Props = {
  file: FileChange;
  viewed: boolean;
  collapsed: boolean;
  /** The agent proposed something in this file — same violet as everywhere. */
  hasFindings: boolean;
  /** Whitespace is hidden and nothing else changed here — without the tag the
   * empty diff under this header reads as a bug. */
  whitespaceOnly: boolean;
  /** Clicking the path selects this file in the tree (no diff re-scroll). */
  onSelectPath: () => void;
  onToggleViewed: () => void;
  onToggleCollapsed: () => void;
};

/**
 * Tandem's own per-file header, projected into @pierre/diffs' sticky header
 * slot (`renderCustomHeader`). It owns what the library's default header
 * can't do for us: the path is a button that syncs the file tree, the chevron
 * folds this one file, and "viewed" is a checkbox HERE — per file, where the
 * file is — rather than one pane-toolbar control acting on the selection.
 */
export function DiffFileHeader({
  file,
  viewed,
  collapsed,
  hasFindings,
  whitespaceOnly,
  onSelectPath,
  onToggleViewed,
  onToggleCollapsed,
}: Props) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const name = slash === -1 ? file.path : file.path.slice(slash + 1);
  const status = STATUS_LABEL[file.status];
  const viewedId = `viewed:${file.path}`;

  return (
    <div className="h-9 bg-muted">
      <div
        className={cn(
          "flex items-center gap-2 px-2 h-full min-w-0 font-mono text-xs",
          viewed && "opacity-60",
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand this file" : "Collapse this file"}
          title={collapsed ? "Expand this file" : "Collapse this file"}
          className="flex items-center shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/60 cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        {hasFindings ? (
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--tandem-agent)" }}
          />
        ) : null}
        <button
          type="button"
          onClick={onSelectPath}
          title={`${file.path} — reveal in the file tree`}
          className="flex items-baseline min-w-0 text-left hover:underline underline-offset-2"
        >
          {dir ? (
            <span className="text-muted-foreground truncate">{dir}</span>
          ) : null}
          <span className="font-semibold shrink-0">{name}</span>
        </button>
        {status ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
            {status}
          </span>
        ) : null}
        {whitespaceOnly ? (
          <span
            title="Only whitespace changed here — turn off “hide whitespace” to see it"
            className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 border border-border rounded-sm px-1"
          >
            whitespace only
          </span>
        ) : null}
        <span className="shrink-0">
          <span className="text-emerald-500">+{file.additions}</span>{" "}
          <span className="text-red-400">−{file.deletions}</span>
        </span>
        {/* The bar's dead space toggles VIEWED, not the fold — clicking a row
          to tick its own checkbox is the ordinary pattern, and "I am done with
          this file" is the thing you do to a header you have finished reading.
          It folds as a consequence, because that is what viewed means here.

          The chevron beside it stays a PURE fold, and the two must NOT be
          merged: `viewed` is a review claim that persists in the draft, counts
          in `viewed n/m` and ships with the submitted review. Peeking back into
          a file you already ticked must not silently un-tick it, and folding a
          generated file out of the way must not claim you read it.

          Mouse-only — `aria-hidden` + `tabIndex={-1}` — so the checkbox stays
          the ONE focusable, labelled control for this action. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggleViewed}
          className="flex-1 self-stretch cursor-pointer"
        />
        <div className="flex items-center gap-1.5 shrink-0 pr-1">
          <Checkbox
            id={viewedId}
            checked={viewed}
            onCheckedChange={onToggleViewed}
            className="w-3.5 h-3.5"
          />
          <label
            htmlFor={viewedId}
            className={cn(
              "cursor-pointer select-none",
              viewed ? "text-foreground" : "text-muted-foreground",
            )}
          >
            viewed
          </label>
        </div>
      </div>
    </div>
  );
}
