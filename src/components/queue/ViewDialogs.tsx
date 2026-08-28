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
  Switch,
  Textarea,
  toast,
} from "@uipath/apollo-wind";
import { hasTeamToken, TEAM_TOKEN } from "../../shared/gh/team";
import type { SavedView } from "../../shared/review-types";
import type { Team } from "../../shared/team-types";
import { formatConfigJson, parseConfigJson } from "../../utils/configJson";
import { appendQualifier, hasScopeQualifier } from "../../utils/searchQuery";
import { QueryHelpButton } from "./QueryHelp";

// ---------------------------------------------------------------------------
// Create / edit one saved view.

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
      <DialogContent>
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
          <div className="space-y-1.5">
            <Label htmlFor="view-team" className="text-xs">
              Team
            </Label>
            <div className="flex items-center gap-2">
              <select
                id="view-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">None</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.members.length})
                  </option>
                ))}
              </select>
              <Button size="xs" variant="outline" onClick={onManageTeams}>
                Manage
              </Button>
            </div>
            {/* Only ever a hint, never a validation error: a query without the
                token is a perfectly good view, and a token without a team
                fails loudly at search time rather than searching all of
                GitHub. */}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {usesTeam ? (
                teamId ? (
                  <>
                    <code className="font-mono text-[10px]">{TEAM_TOKEN}</code>{" "}
                    in the query above expands to this team's logins, chunked
                    into parallel searches so a big team is not truncated to one
                    page.
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
                  <code className="font-mono text-[10px]">
                    {"author:{team}"}
                  </code>
                  ,{" "}
                  <code className="font-mono text-[10px]">
                    {"review-requested:{team}"}
                  </code>
                  , or on its own for authors.
                </>
              )}
            </p>
          </div>
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
// The whole queue configuration as JSON: view, copy (export/share), paste
// (import), apply. Views AND teams — a view carries a `teamId`, so shipping
// one without its team hands the reader a view that refuses to search.

type JsonProps = {
  views: SavedView[];
  teams: Team[];
  open: boolean;
  onClose: () => void;
  onApply: (config: { views: SavedView[]; teams: Team[] | null }) => void;
};

export function ConfigJsonDialog({
  views,
  teams,
  open,
  onClose,
  onApply,
}: JsonProps) {
  const [draft, setDraft] = useState(() => formatConfigJson(views, teams));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const parsed = parseConfigJson(draft);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    onApply(parsed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* sm: variant, or apollo's own `sm:max-w-lg` wins the cascade — see
          TeamDialogs for the same trap. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configuration as JSON</DialogTitle>
          <DialogDescription>
            The views in{" "}
            <code className="font-mono text-[11px]">~/.tandem/views.json</code>{" "}
            and the teams in{" "}
            <code className="font-mono text-[11px]">~/.tandem/teams.json</code>.
            Copy it to share; paste a teammate's to import. Applying replaces
            ALL views, and all teams when the payload lists any.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          className="min-h-72 text-xs font-mono"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="mr-auto"
            onClick={() => {
              void navigator.clipboard
                .writeText(draft)
                .then(() => toast.success("Configuration copied"));
            }}
          >
            Copy JSON
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
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
