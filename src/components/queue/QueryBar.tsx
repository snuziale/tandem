import { useEffect, useState } from "react";
import { Button, Input } from "@uipath/apollo-wind";
import { Pencil } from "lucide-react";
import { expandTeamQuery, hasTeamToken } from "../../shared/gh/team";
import type { RateLimitInfo } from "../../shared/review-types";
import type { Team } from "../../shared/team-types";
import { refreshAge } from "../../utils/time";

type Props = {
  query: string;
  /** The view's team, if it has one — used only to SHOW what `{team}` expands
   * to. The server does the real expansion before searching. */
  team: Team | null;
  /** How many parallel searches the last poll of this view actually ran. */
  shards: number | undefined;
  onCommit: (query: string) => void;
  onEditView: () => void;
  rateLimit: RateLimitInfo | null;
  dataUpdatedAt: number;
};

// The raw GitHub search query, always visible and editable (spec §3.1) — the
// user should never wonder what they're looking at. Enter commits, Esc reverts.
export function QueryBar({
  query,
  team,
  shards,
  onCommit,
  onEditView,
  rateLimit,
  dataUpdatedAt,
}: Props) {
  const [draft, setDraft] = useState(query);
  // Reset the draft when the committed query changes from outside (view
  // switch, save round-trip) — render-time adjustment, not an effect.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  // Ticks the "refreshed Ns ago" label without waiting for a data change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // The query stays RAW — `{team}` included — because that is the string the
  // user owns. What it expands to is shown underneath instead of replacing it,
  // so editing never fights a rewrite.
  const expanded = hasTeamToken(query) ? expandTeamQuery(query, team) : null;

  return (
    // A secondary bar under the header: same 16px gutter as the queue grid, so
    // the label lines up with the "pull request" column.
    <div className="flex flex-col gap-1 px-4 py-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono shrink-0">
          query
        </span>
        <Input
          id="queue-query-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && draft !== query)
              onCommit(draft.trim());
            if (e.key === "Escape") setDraft(query);
          }}
          spellCheck={false}
          className="h-7 font-mono text-xs flex-1"
        />
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label="Edit this view"
          onClick={onEditView}
        >
          <Pencil />
        </Button>
        <span className="text-[11px] text-muted-foreground font-mono shrink-0 tabular-nums">
          {rateLimit
            ? `GraphQL ${rateLimit.remaining}/${rateLimit.limit} · `
            : ""}
          {refreshAge(dataUpdatedAt, now)}
        </span>
      </div>
      {expanded ? (
        <p className="text-[10px] text-muted-foreground font-mono pl-[3.25rem] truncate">
          {team ? (
            <>
              → {expanded}
              {shards !== undefined && shards > 1
                ? `  ·  ${shards} parallel searches`
                : ""}
            </>
          ) : (
            <span className="text-yellow-600 dark:text-yellow-400">
              {"{team}"} with no team attached — this view will not search
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}
