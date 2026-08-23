import { Check, Eye } from "lucide-react";
import { cn } from "@uipath/apollo-wind";
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
  /** The agent proposed something in this file — same violet as everywhere. */
  hasFindings: boolean;
  /** Clicking the path selects this file in the tree (no diff re-scroll). */
  onSelectPath: () => void;
  onToggleViewed: () => void;
};

/**
 * Tandem's own per-file header, projected into @pierre/diffs' sticky header
 * slot (`renderCustomHeader`). It owns the two things the library's default
 * header can't do for us: the path is a button that syncs the file tree, and
 * "viewed" is toggled HERE — per file, where the file is — rather than from a
 * single control in the pane toolbar acting on whatever was selected.
 */
export function DiffFileHeader({
  file,
  viewed,
  hasFindings,
  onSelectPath,
  onToggleViewed,
}: Props) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const name = slash === -1 ? file.path : file.path.slice(slash + 1);
  const status = STATUS_LABEL[file.status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 h-9 min-w-0 font-mono text-xs bg-background",
        viewed && "opacity-60",
      )}
    >
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
      <span className="shrink-0">
        <span className="text-emerald-500">+{file.additions}</span>{" "}
        <span className="text-red-400">−{file.deletions}</span>
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onToggleViewed}
        aria-pressed={viewed}
        className={cn(
          "flex items-center gap-1 px-1.5 h-6 rounded-sm shrink-0 cursor-pointer",
          viewed
            ? "text-foreground bg-accent"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
        )}
      >
        {viewed ? <Check className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        {viewed ? "viewed" : "mark viewed"}
      </button>
    </div>
  );
}
