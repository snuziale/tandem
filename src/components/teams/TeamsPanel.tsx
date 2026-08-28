// Team management: the list of people a view's `{team}` token expands to.
//
// Deliberately a plain list editor. A team is a name and some GitHub logins —
// the richer shape this replaced (display names, emails, managers, repos, a
// GitHub-team sync, a paste-and-filter importer) carried five fields nothing
// ever read and a whole import panel for a list you can type in ten seconds.
//
// This is the PANEL, not a screen: Settings › Teams renders it inline (a team
// is durable configuration, so that is its home) and the view editor still
// opens it in a dialog, because creating a team mid-query must not throw away
// the half-written view. One implementation, two frames.
import { useMemo, useState } from "react";
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
  Input,
  Label,
  Textarea,
  cn,
} from "@uipath/apollo-wind";
import { Plus, Trash2, Users } from "lucide-react";
import { normalizeLogins, type Team } from "../../shared/team-types";

/** What a team IS, in one sentence and three examples. Both frames show it —
 * the settings section above the panel, the dialog in its description — and
 * they must not describe the `{team}` token two different ways. */
export function TeamTokenBlurb() {
  return (
    <>
      A named list of GitHub logins. Put{" "}
      <code className="font-mono text-[11px]">{"{team}"}</code> in a view's
      query wherever a person goes —{" "}
      <code className="font-mono text-[11px]">{"author:{team}"}</code>,{" "}
      <code className="font-mono text-[11px]">{"review-requested:{team}"}</code>{" "}
      — and it expands to everyone on the list. The qualifier you attach it to
      is the one that repeats, so the query keeps saying what it does.
    </>
  );
}

export type TeamsPanelProps = {
  teams: Team[];
  onSave: (team: Team) => void;
  onDelete: (id: string) => void;
  /** Height/spacing of the two-column body — the frame decides, not the
   * panel: a dialog is capped against the viewport, the settings page fills
   * what its section gives it. */
  className?: string;
};

function newTeam(): Team {
  return { id: crypto.randomUUID(), name: "", members: [] };
}

/**
 * What the editor is pointed at. ONE piece of state, not a `selectedId` beside
 * a `draftNew`: those two are mutually exclusive, so as separate values they
 * can disagree — a stale id sitting under an open draft, and a row that has to
 * ask about both to know whether it is highlighted.
 */
type Selection =
  { kind: "new"; team: Team } | { kind: "existing"; id: string } | null;

export function TeamsPanel({
  teams,
  onSave,
  onDelete,
  className,
}: TeamsPanelProps) {
  const [selection, setSelection] = useState<Selection>(() =>
    teams.length === 0
      ? { kind: "new", team: newTeam() }
      : { kind: "existing", id: teams[0].id },
  );
  const [deleting, setDeleting] = useState<Team | null>(null);

  const selected =
    selection?.kind === "new"
      ? selection.team
      : (teams.find((t) => t.id === selection?.id) ?? null);

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-[16rem_minmax(0,1fr)] gap-6 min-h-0",
          className,
        )}
      >
        <div className="flex flex-col gap-1 border-r border-border pr-3 overflow-y-auto min-h-0">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelection({ kind: "existing", id: team.id })}
              className={cn(
                "text-left rounded-sm px-2 py-1.5 hover:bg-accent/60",
                selection?.kind === "existing" &&
                  selection.id === team.id &&
                  "bg-accent",
              )}
            >
              <div className="text-sm truncate flex items-center gap-1.5">
                <Users className="size-3 shrink-0 text-muted-foreground" />
                {team.name}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {team.members.length} member
                {team.members.length === 1 ? "" : "s"}
              </div>
            </button>
          ))}
          <Button
            size="xs"
            variant="ghost"
            className="justify-start mt-1"
            onClick={() => setSelection({ kind: "new", team: newTeam() })}
          >
            <Plus /> New team
          </Button>
        </div>

        {selected ? (
          <TeamEditor
            key={selected.id}
            team={selected}
            isNew={selection?.kind === "new"}
            onDelete={() => setDeleting(selected)}
            onSave={(next) => {
              onSave(next);
              setSelection({ kind: "existing", id: next.id });
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground self-center text-center">
            No teams yet.
          </p>
        )}
      </div>

      {deleting ? (
        <AlertDialog open onOpenChange={(v) => !v && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deleting.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Any view whose query uses{" "}
                <code className="font-mono text-[11px]">{"{team}"}</code> will
                fail loudly until you point it at another team — deliberately,
                because a token that expanded to nothing would silently search
                all of GitHub.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel onClick={() => setDeleting(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  onDelete(deleting.id);
                  setSelection(null);
                  setDeleting(null);
                }}
              >
                Delete team
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function TeamEditor({
  team,
  isNew,
  onSave,
  onDelete,
}: {
  team: Team;
  isNew: boolean;
  onSave: (team: Team) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [members, setMembers] = useState(team.members.join("\n"));

  // Whitespace or commas, `@alice` or `alice` — split here, but let the shared
  // rule decide what a login is, so the count under the box is the count that
  // gets saved rather than one the store then quietly shrinks.
  const parsed = useMemo(
    () => normalizeLogins(members.split(/[\s,]+/)),
    [members],
  );

  return (
    <div className="flex flex-col gap-3 overflow-y-auto min-h-0 pr-1 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="team-name" className="text-xs">
          Name
        </Label>
        <Input
          id="team-name"
          autoFocus={isNew}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My team"
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
        <Label htmlFor="team-members" className="text-xs">
          GitHub logins ({parsed.length})
        </Label>
        <Textarea
          id="team-members"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          spellCheck={false}
          placeholder={"alice\nbob\ncarol"}
          className="min-h-48 flex-1 text-xs font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          One per line, or separated by spaces or commas. A leading @ is fine.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="xs"
          disabled={!name.trim()}
          onClick={() =>
            onSave({ ...team, name: name.trim(), members: parsed })
          }
        >
          {isNew ? "Create team" : "Save team"}
        </Button>
        {!isNew ? (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={onDelete}
          >
            <Trash2 /> Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
