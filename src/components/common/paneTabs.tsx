import { Tabs, TabsList, TabsTrigger, cn } from "@uipath/apollo-wind";

/**
 * The ONE pane-header tab strip.
 *
 * Three headers wear it — the files column (`Files | Description`), the diff
 * toolbar (`Unified | Split`) and the agent pane (`List | Split | Chat`) — and
 * every one of them is an `h-9` row. Apollo's default `TabsList` is `h-10`
 * with `text-sm` triggers, which does not fit in 36px.
 *
 * It is a COMPONENT and not a pair of class strings, because the size was
 * never the only thing the three call sites had to agree on. Each also owes
 * one `aria-label` on the list, `aria-controls` on EVERY trigger pointing at
 * the one region the strip names, and a coercion back from Radix's `string`
 * to its own union. Exporting the size alone left that contract copied three
 * times, and it had already drifted before it shipped: one strip carried no
 * `aria-label`, and the three coercions were a cast, a validation and a
 * ternary. Seven triggers is seven chances to omit an `aria-controls` nothing
 * would ever show you.
 *
 * `onValueChange` fires only for a tab this strip actually declares, which is
 * what narrows Radix's `string` back to `T` — the call sites stop guessing.
 *
 * Sizing only, still: no color and no font family. Those come from apollo,
 * which is the whole point of using its `Tabs` here rather than dressing up a
 * ToggleGroup.
 */
const PANE_TABS_LIST = "h-7 p-0.5 gap-0.5 min-w-0";

const PANE_TABS_TRIGGER = "h-6 gap-1 px-2 text-xs min-w-0";

export type PaneTab<T extends string> = {
  value: T;
  label: string;
  /** Trailing count, muted — the files column's file total. */
  badge?: React.ReactNode;
  /** Nothing to show is a disabled tab, never an empty panel. */
  disabled?: boolean;
};

type Props<T extends string> = Omit<
  React.ComponentProps<typeof Tabs>,
  "value" | "onValueChange" | "children"
> & {
  value: T;
  onValueChange: (value: T) => void;
  /** Names the strip for a screen reader. */
  label: string;
  /** The one region every trigger points `aria-controls` at. */
  panelId: string;
  tabs: ReadonlyArray<PaneTab<T>>;
};

export function PaneTabs<T extends string>({
  value,
  onValueChange,
  label,
  panelId,
  tabs,
  className,
  ...rest
}: Props<T>) {
  return (
    // `rest` carries the ref through: the agent pane's strip is wrapped in a
    // `TooltipTrigger asChild`, which clones this element with one.
    <Tabs
      value={value}
      onValueChange={(next) => {
        const tab = tabs.find((t) => t.value === next);
        if (tab) onValueChange(tab.value);
      }}
      className={cn("min-w-0", className)}
      {...rest}
    >
      <TabsList aria-label={label} className={PANE_TABS_LIST}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            aria-controls={panelId}
            disabled={tab.disabled}
            className={PANE_TABS_TRIGGER}
          >
            <span className="truncate">{tab.label}</span>
            {tab.badge == null ? null : (
              <span className="text-muted-foreground tabular-nums">
                {tab.badge}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
