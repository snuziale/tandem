import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uipath/apollo-wind";
import { SHORTCUT_GROUPS } from "../../keyboard/shortcuts";
import { useUiStore } from "../../state/uiStore";
import { Shortcut } from "./Kbd";

export function ShortcutsHelp() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        {/* The sheet is the longest list of shortcuts in the app, so it owns
            the scroll rather than pushing the dialog past the viewport. */}
        <div className="grid grid-cols-1 gap-5 max-h-[70vh] overflow-y-auto -mr-2 pr-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">
                {group.title}
              </div>
              {/* Keys in their own right-aligned column: chips of different
                  widths ("esc" vs "j") left-aligned made a ragged edge that
                  the eye reads as a list of words, not of keys. */}
              <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {group.items.map((item) => (
                  <div
                    key={item.keys.join("+") + item.action}
                    className="contents"
                  >
                    <div className="flex items-baseline justify-end gap-1.5 text-foreground">
                      <Shortcut keys={item.keys} />
                      {item.gesture ? (
                        <span className="text-muted-foreground text-[11px] text-right">
                          {item.gesture}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground">{item.action}</span>
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
