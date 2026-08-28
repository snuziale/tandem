import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@uipath/apollo-wind";
import { CircleHelp } from "lucide-react";
import { TEAM_TOKEN } from "../../shared/gh/team";

// A view is a RAW GitHub search query and that is deliberate (spec §3.1) — but
// the raw string only reads as an invitation once you know the vocabulary.
// Nothing in the app said "repo:owner/name", so a first view was a guess. This
// is the reference, next to the box you type it in, and every row is also the
// insert button — the fastest way to learn a qualifier is to watch it land in
// your own query.
//
// Deliberately NOT the whole GitHub grammar: these are the qualifiers a review
// queue actually uses. The footer link owns the long tail.

type Qualifier = {
  /** What's shown — and what's inserted, unless `insert` differs. */
  token: string;
  insert?: string;
  hint: string;
};

const GROUPS: { title: string; items: Qualifier[] }[] = [
  {
    title: "Where to look",
    items: [
      { token: "repo:owner/name", hint: "one repository" },
      { token: "org:owner", hint: "every repo in an org" },
      { token: "user:login", hint: "every repo owned by a person" },
    ],
  },
  {
    title: "Whose PRs",
    items: [
      { token: "review-requested:@me", hint: "waiting on your review" },
      { token: "author:@me", hint: "yours" },
      { token: "assignee:@me", hint: "assigned to you" },
      { token: "involves:@me", hint: "author, assignee, mention or reviewer" },
      { token: "reviewed-by:login", hint: "already reviewed by someone" },
      {
        token: `author:${TEAM_TOKEN}`,
        hint: "a saved team, expanded to its logins",
      },
    ],
  },
  {
    title: "What state",
    items: [
      { token: "is:open", hint: "not merged or closed" },
      { token: "draft:false", hint: "ready for review only" },
      { token: "review:none", hint: "nobody has reviewed yet" },
      { token: "review:approved", hint: "approved" },
      { token: "status:success", hint: "checks green" },
      { token: 'label:"needs review"', hint: "carries a label" },
      { token: "-label:wip", hint: "a leading - excludes" },
    ],
  },
  {
    title: "When, and in what order",
    items: [
      { token: "updated:>=2026-08-01", hint: "touched since a date" },
      { token: "created:<2026-08-01", hint: "opened before a date" },
      { token: "sort:updated-desc", hint: "most recently touched first" },
      { token: "sort:created-asc", hint: "oldest first" },
    ],
  },
];

type Props = {
  /** Appends the qualifier to the query being edited. */
  onInsert: (token: string) => void;
  /** Focused after an insert, so typing continues where it landed. */
  focusTargetId?: string;
};

export function QueryHelpButton({ onInsert, focusTargetId }: Props) {
  const insert = (token: string) => {
    onInsert(token);
    if (!focusTargetId) return;
    // After the controlled value round-trips, or the caret sits on stale text.
    requestAnimationFrame(() => {
      const el = document.getElementById(focusTargetId);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="2xs"
              icon
              variant="ghost"
              aria-label="Search qualifiers"
              className="text-muted-foreground"
            >
              <CircleHelp />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>
            Search qualifiers — click one to add it
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium">GitHub search qualifiers</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Space-separated, all ANDed. Click one to append it to the query.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {GROUPS.map((group) => (
            <div key={group.title} className="py-1">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.title}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => insert(item.insert ?? item.token)}
                  className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-accent"
                >
                  <code className="font-mono text-[11px] shrink-0">
                    {item.token}
                  </code>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {item.hint}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
          <code className="font-mono text-[10px]">{TEAM_TOKEN}</code> is ours,
          not GitHub's — it stands in for a person and expands to the view's
          team. Everything else is documented at{" "}
          <a
            href="https://docs.github.com/search-github/searching-on-github/searching-issues-and-pull-requests"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            docs.github.com
          </a>
          .
        </div>
      </PopoverContent>
    </Popover>
  );
}
