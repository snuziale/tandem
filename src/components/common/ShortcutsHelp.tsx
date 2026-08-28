import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uipath/apollo-wind";
import { SHORTCUT_GROUPS, type ShortcutGroup } from "../../keyboard/shortcuts";
import { useUiStore } from "../../state/uiStore";
import { Shortcut } from "./Kbd";

/**
 * Deal the groups into two columns of roughly equal height, keeping each group
 * whole and in source order.
 *
 * Explicitly, and NOT with `columns-2` or a two-cell grid, because both get it
 * wrong on exactly this data. CSS columns fragment: with `break-inside-avoid`
 * the 18-row "PR detail" group can't be split, so the balancer overflows into a
 * THIRD column the dialog then clips — "Anywhere" simply disappeared. A grid
 * aligns children to rows instead, so the 2-row group would start level with
 * the bottom of the 18-row one and leave half a screen of dead space.
 *
 * A row costs one, the heading one more — near enough, since every row is one
 * line at this width.
 */
function balanceColumns(
  groups: ShortcutGroup[],
): [ShortcutGroup[], ShortcutGroup[]] {
  const columns: [ShortcutGroup[], ShortcutGroup[]] = [[], []];
  const heights = [0, 0];
  for (const group of groups) {
    const into = heights[0] <= heights[1] ? 0 : 1;
    columns[into].push(group);
    heights[into] += group.items.length + 1;
  }
  return columns;
}

export function ShortcutsHelp() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* `sm:max-w-*`, not `max-w-*`: apollo's DialogContent carries
          `sm:max-w-lg`, and a responsive variant beats a plain utility however
          the classes are ordered — a bare `max-w-xl` here was inert, which is
          why this sheet spent its life at 32rem. `w-[min(...)]` re-caps it for
          a viewport between the `sm` breakpoint and the max width. */}
      <DialogContent className="sm:max-w-5xl w-[min(64rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        {/* Two columns at width, one when there isn't any. The sheet is the
            longest list in the app, so it still owns the scroll rather than
            pushing the dialog past the viewport. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 items-start max-h-[70vh] overflow-y-auto -mr-2 pr-2">
          {balanceColumns(SHORTCUT_GROUPS).map((column, i) => (
            <div key={i} className="grid gap-5">
              {column.map((group) => (
                <div key={group.title}>
                  <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">
                    {group.title}
                  </div>
                  {/* Keys in their own right-aligned column: chips of different
                      widths ("esc" vs "j") left-aligned made a ragged edge that
                      the eye reads as a list of words, not of keys. */}
                  <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
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
                        <span className="text-muted-foreground">
                          {item.action}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
