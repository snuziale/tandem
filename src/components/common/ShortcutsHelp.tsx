import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uipath/apollo-wind";
import { SHORTCUT_GROUPS } from "../../keyboard/shortcuts";
import { useUiStore } from "../../state/uiStore";

export function ShortcutsHelp() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map(([keys, action]) => (
                  <div
                    key={keys + action}
                    className="flex items-baseline gap-3 text-sm"
                  >
                    <kbd className="font-mono text-xs border border-border rounded px-1.5 py-0.5 whitespace-nowrap">
                      {keys}
                    </kbd>
                    <span className="text-muted-foreground">{action}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
