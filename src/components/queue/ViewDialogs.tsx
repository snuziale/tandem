import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@uipath/apollo-wind";
import { hasTeamToken, TEAM_TOKEN } from "../../shared/gh/team";
import type { SavedView } from "../../shared/review-types";
import type { Team } from "../../shared/team-types";
import { appendQualifier, hasScopeQualifier } from "../../utils/searchQuery";
import { QueryHelpButton } from "./QueryHelp";

// ---------------------------------------------------------------------------
// Create / edit one saved view.

/** Radix spells "nothing is selected" as `""` and so refuses it as an item
 * value — but `""` is what a `SavedView` carries for "no team". The sentinel
 * lives on the wire between them, never in the view. */
const NO_TEAM = "__none__";

type EditorProps = {
  /** Null = create a new view. */
  view: SavedView | null;
  teams: Team[];
  open: boolean;
  onClose: () => void;
  onSave: (view: SavedView) => void;
  onManageTeams: () => void;
};

export function ViewEditorDialog({
  view,
  teams,
  open,
  onClose,
  onSave,
  onManageTeams,
}: EditorProps) {
  const [name, setName] = useState(view?.name ?? "");
  const [query, setQuery] = useState(
    view?.query ?? "is:pr is:open archived:false sort:updated-desc ",
  );
  const [agentEnabled, setAgentEnabled] = useState(view?.agentEnabled ?? false);
  const [teamId, setTeamId] = useState(view?.teamId ?? "");

  const usesTeam = hasTeamToken(query);
  // Say it sooner than an empty queue would: without a scoping qualifier the
  // search is every open PR on GitHub.
  const needsScope = !hasScopeQualifier(query);
  const canSave = name.trim().length > 0 && query.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    onSave({
      id: view?.id ?? crypto.randomUUID(),
      name: name.trim(),
      query: query.trim(),
      agentEnabled,
      teamId: teamId || undefined,
      position: view?.position ?? Number.MAX_SAFE_INTEGER,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* `sm:max-w-*`, not `max-w-*`: apollo's DialogContent already carries
          `sm:max-w-lg`, and a responsive variant wins the cascade over a plain
          utility no matter what order they are written in. The query is a
          monospace one-liner that routinely runs past 32rem — at the default
          width it wrapped three times and stopped reading as a query. */}
      <DialogContent className="sm:max-w-3xl w-[min(48rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{view ? "Edit view" : "New view"}</DialogTitle>
          <DialogDescription>
            A view is a raw GitHub search query shown as a queue tab — e.g.{" "}
            <code className="font-mono text-[11px]">
              is:pr is:open repo:acme/web review-requested:@me
            </code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* The two short fields share a row. Neither is improved by 45rem of
              input, and stacking them pushed the query — the field that DOES
              want the width — below the fold. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="space-y-1.5">
              <Label htmlFor="view-name" className="text-xs">
                Name
              </Label>
              <Input
                id="view-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="acme/web only"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              {/* Not `htmlFor`-linked: apollo's trigger is a `<button>`, which
                  `<label for>` does not associate with. */}
              <Label className="text-xs">Team</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={teamId || NO_TEAM}
                  onValueChange={(v) => setTeamId(v === NO_TEAM ? "" : v)}
                >
                  <SelectTrigger
                    className="h-8 flex-1 min-w-0 px-2 text-sm"
                    aria-label="Team"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEAM} className="text-sm">
                      None
                    </SelectItem>
                    {teams.map((team) => (
                      <SelectItem
                        key={team.id}
                        value={team.id}
                        className="text-sm"
                      >
                        {team.name} ({team.members.length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="xs" variant="outline" onClick={onManageTeams}>
                  Manage
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="view-query" className="text-xs">
                GitHub search query
              </Label>
              <QueryHelpButton
                focusTargetId="view-query"
                onInsert={(token) => setQuery((q) => appendQualifier(q, token))}
              />
            </div>
            <Textarea
              id="view-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
              className="min-h-16 text-sm font-mono"
            />
            {/* The starter query has no scope, so a brand-new view searches all
                of GitHub — say which qualifier narrows it rather than letting
                the first save be a surprise. */}
            {needsScope ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Nothing scopes this yet — add{" "}
                <code className="font-mono text-[10px]">repo:owner/name</code>{" "}
                or <code className="font-mono text-[10px]">org:owner</code>, or
                a person qualifier like{" "}
                <code className="font-mono text-[10px]">
                  review-requested:@me
                </code>
                .
              </p>
            ) : null}
          </div>
          {/* The team HINT sits under the query, not under the select it
              belongs to: it is a sentence about the `{team}` token in the text
              above it, and hanging a five-line paragraph off a half-width
              column made that row twice the height of the name beside it.
              Only ever a hint, never a validation error — a query without the
              token is a perfectly good view, and a token without a team fails
              loudly at search time rather than searching all of GitHub. */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {usesTeam ? (
              teamId ? (
                <>
                  <code className="font-mono text-[10px]">{TEAM_TOKEN}</code> in
                  the query above expands to this team's logins, chunked into
                  parallel searches so a big team is not truncated to one page.
                </>
              ) : (
                <span className="text-yellow-600 dark:text-yellow-400">
                  This query uses{" "}
                  <code className="font-mono text-[10px]">{TEAM_TOKEN}</code>{" "}
                  but no team is selected — the view will refuse to search.
                </span>
              )
            ) : (
              <>
                Optional. Put{" "}
                <code className="font-mono text-[10px]">{TEAM_TOKEN}</code> in
                the query wherever a person goes —{" "}
                <code className="font-mono text-[10px]">{"author:{team}"}</code>
                ,{" "}
                <code className="font-mono text-[10px]">
                  {"review-requested:{team}"}
                </code>
                , or on its own for authors.
              </>
            )}
          </p>
          <div className="flex items-start justify-between gap-6 pt-1">
            <div>
              <div className="text-sm">Agent pre-warm eligible</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                PRs in this view are analyzed automatically — only when "Run
                automatically" is on in Settings.
              </div>
            </div>
            <Switch checked={agentEnabled} onCheckedChange={setAgentEnabled} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {view ? "Save view" : "Add view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deleting a view throws away a hand-written query — always confirm.

export function DeleteViewDialog({
  view,
  onClose,
  onConfirm,
}: {
  view: SavedView;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{view.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            The view and its query are removed from{" "}
            <code className="font-mono text-[11px]">~/.tandem/views.json</code>.
            Nothing on GitHub changes, and no pending review is touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Delete view
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
