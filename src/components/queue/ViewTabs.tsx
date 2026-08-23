import { useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import type { SavedView } from "../../shared/review-types";

export type ViewTabActions = {
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onEdit: (view: SavedView) => void;
  onDuplicate: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
  onAddView: () => void;
};

type Props = ViewTabActions & {
  views: SavedView[];
  counts: Record<string, number>;
  activeViewId: string | null;
};

/**
 * The queue's view strip. Row content only — AppHeader owns the chrome around
 * it. Each tab carries its own menu (rename inline · edit query · duplicate ·
 * delete); selection itself is a URL navigation, handled by the parent.
 */
export function ViewTabs({
  views,
  counts,
  activeViewId,
  onAddView,
  ...actions
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1 min-w-0">
      {views.length > 0 ? (
        // Flat like the rest of the app: no segmented-control tray, the active
        // view is just the one pill that's filled in.
        <div
          role="tablist"
          className="flex items-center gap-1 min-w-0 overflow-x-auto"
        >
          {views.map((view) => (
            <ViewTab
              key={view.id}
              view={view}
              count={counts[view.id]}
              active={view.id === activeViewId}
              renaming={renamingId === view.id}
              onStartRename={() => setRenamingId(view.id)}
              onEndRename={() => setRenamingId(null)}
              {...actions}
            />
          ))}
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="2xs"
            icon
            variant="ghost"
            aria-label="New view"
            onClick={onAddView}
          >
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>New view</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </div>
  );
}

type TabProps = Omit<ViewTabActions, "onAddView"> & {
  view: SavedView;
  count: number | undefined;
  active: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onEndRename: () => void;
};

function ViewTab({
  view,
  count,
  active,
  renaming,
  onStartRename,
  onEndRename,
  onSelect,
  onRename,
  onEdit,
  onDuplicate,
  onDelete,
}: TabProps) {
  if (renaming) {
    return (
      <NameEditor
        name={view.name}
        onCommit={(name) => {
          if (name && name !== view.name) onRename(view.id, name);
          onEndRename();
        }}
        onCancel={onEndRename}
      />
    );
  }

  // One item list, two triggers: the ⋯ button and right-click on the tab.
  const items = [
    { label: "Rename", run: onStartRename },
    { label: "Edit query…", run: () => onEdit(view) },
    { label: "Duplicate", run: () => onDuplicate(view) },
    { label: "Delete", run: () => onDelete(view), destructive: true },
  ];
  const itemClass = (destructive?: boolean) =>
    cn("text-xs", destructive && "text-destructive focus:text-destructive");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group/tab flex items-center h-7 rounded-sm shrink-0 transition-colors",
            active
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(view.id)}
            onDoubleClick={onStartRename}
            className="flex items-center gap-1.5 h-full pl-2.5 pr-1 text-xs font-mono min-w-0 cursor-pointer"
          >
            <span className="truncate max-w-40" title={view.name}>
              {view.name}
            </span>
            {count !== undefined ? (
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  active ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Manage view ${view.name}`}
                className={cn(
                  "flex items-center justify-center w-5 h-5 mr-1 rounded-sm text-muted-foreground cursor-pointer",
                  "hover:bg-accent hover:text-foreground",
                  "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                  active && "opacity-60",
                )}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {items.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  onSelect={item.run}
                  className={itemClass(item.destructive)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item) => (
          <ContextMenuItem
            key={item.label}
            onSelect={item.run}
            className={itemClass(item.destructive)}
          >
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Inline tab rename. Enter commits, Esc cancels, blur commits — once. */
function NameEditor({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const settled = useRef(false);
  const settle = (fn: () => void) => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };

  return (
    <Input
      autoFocus
      defaultValue={name}
      aria-label="View name"
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter")
          settle(() => onCommit(e.currentTarget.value.trim()));
        if (e.key === "Escape") settle(onCancel);
      }}
      onBlur={(e) => settle(() => onCommit(e.currentTarget.value.trim()))}
      className="h-6 w-40 px-1.5 text-xs font-mono shrink-0"
    />
  );
}
