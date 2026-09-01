import { useId, useState } from "react";
import { Markdown } from "../common/Markdown";
import { stripHtmlComments } from "../common/markdownText";
import { PaneTabs } from "../common/paneTabs";

/**
 * The PR description, as the second TAB of the files column.
 *
 * It has been three things. A full-width band under the PR header, which
 * pushed the diff down the screen to read prose. Then a section stacked above
 * the file tree, which split one narrow column into two cramped ones. Now the
 * column is a tab strip and whichever tab is selected owns the whole height: a
 * description is a document, it wants the tallest space this layout has rather
 * than the widest, and the diff never gives up a pixel for it.
 *
 * **NOTHING here unmounts.** The panel is an OVERLAY (`absolute inset-0`), not
 * a swap, and deliberately not `TabsContent` — Radix unmounts an inactive
 * panel, and even `forceMount` hides it with the `hidden` attribute.
 * `useFileTree` builds its model once and @pierre/trees keys scroll position,
 * expansion and selection to it, so either would reset the reviewer's place in
 * a 300-file PR every time they glanced at the description; `display: none`
 * would also drop the measured size the virtualizer needs on the way back. So
 * the two tabs address ONE panel region — `panelId` — which is what both
 * triggers point `aria-controls` at.
 *
 * The description pays the SAME courtesy back once it has been opened: it
 * stays mounted behind `hidden` rather than being torn down on the way out.
 * react-markdown memoizes nothing, so a re-mount re-runs the whole
 * remark/rehype parse of the PR body and drops the panel's scroll position —
 * which is exactly the cost this file refuses to pay for the tree one line
 * above. The objection that rules `hidden` out for the TREE (a virtualizer
 * needs its measured size) does not apply here: this is a plain scroll box.
 * It is not mounted before first use, so a reviewer who never opens the tab
 * never pays the parse at all.
 *
 * A HOOK returning nodes, because its one piece of state sits in two places —
 * the column header and the column body. This file's only export is that
 * hook, so the JSX is inline: a component declared beside it is what
 * react-refresh refuses, and a suppression here would cost the React Compiler
 * the whole file.
 */
export function usePrDescription(bodyMarkdown: string, fileCount: number) {
  // Files on every PR: the column is navigation first, and a description tab
  // that persisted would hide the tree on a PR you opened to read code.
  const [tab, setTab] = useState<"files" | "description">("files");
  // Latched on first open — see the note above on why the panel outlives its
  // own tab, and why it is still not there before anyone asks for it.
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const description = stripHtmlComments(bodyMarkdown).trim() || null;
  const showing = tab === "description" && description !== null;
  return {
    /** Both tabs address this one region; it goes on the column's body. */
    panelId,
    tabs: (
      <PaneTabs
        label="Files or description"
        panelId={panelId}
        value={showing ? "description" : "files"}
        onValueChange={(next) => {
          setTab(next);
          if (next === "description") setOpened(true);
        }}
        tabs={[
          // The count belongs ON its tab. Loose beside the strip it was a bare
          // number with nothing naming it.
          { value: "files", label: "Files", badge: fileCount },
          {
            value: "description",
            label: "Description",
            // Nothing to show is a disabled tab, not an empty panel — a body
            // that is only the PR template's HTML comments is the common case.
            disabled: description === null,
          },
        ]}
      />
    ),
    panel:
      opened && description !== null ? (
        <div
          hidden={!showing}
          className="absolute inset-0 z-10 overflow-y-auto bg-background px-3 py-2.5"
        >
          <Markdown className="min-w-0">{description}</Markdown>
        </div>
      ) : null,
    /** True while the description covers the tree — the column's search
     * control stands down, since there is nothing of the tree to search. */
    showing,
  };
}
