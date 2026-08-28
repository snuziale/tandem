// Team management: the list of people a view's `{team}` token expands to.
//
// Deliberately a plain list editor. A team is a name and some GitHub logins —
// the richer shape this replaced (display names, emails, managers, repos, a
// GitHub-team sync, a paste-and-filter importer) carried five fields nothing
// ever read and a whole import panel for a list you can type in ten seconds.
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  cn,
} from "@uipath/apollo-wind";
import { Plus, Trash2, Users } from "lucide-react";
import { normalizeLogins, type Team } from "../../shared/team-types";

type ManagerProps = {
  teams: Team[];
  open: boolean;
  onClose: () => void;
  onSave: (team: Team) => void;
  onDelete: (id: string) => void;
};

function newTeam(): Team {
  return { id: crypto.randomUUID(), name: "", members: [] };
}

export function TeamManagerDialog({
  teams,
  open,
  onClose,
  onSave,
  onDelete,
}: ManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    teams[0]?.id ?? null,
  );
  const [draftNew, setDraftNew] = useState<Team | null>(
    teams.length === 0 ? newTeam() : null,
  );
  const [deleting, setDeleting] = useState<Team | null>(null);

  const selected = draftNew ?? teams.find((t) => t.id === selectedId) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        {/* `sm:max-w-*`, not `max-w-*`: apollo's DialogContent already carries
            `sm:max-w-lg`, and a responsive variant wins the cascade over a
            plain utility no matter what order they are written in. */}
        <DialogContent className="sm:max-w-3xl w-[min(48rem,92vw)]">
          <DialogHeader>
            <DialogTitle>Teams</DialogTitle>
            <DialogDescription>
              A named list of GitHub logins. Put{" "}
              <code className="font-mono text-[11px]">{"{team}"}</code> in a
              view's query wherever a person goes —{" "}
              <code className="font-mono text-[11px]">{"author:{team}"}</code>,{" "}
              <code className="font-mono text-[11px]">
                {"review-requested:{team}"}
              </code>{" "}
              — and it expands to everyone on the list.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-5 min-h-72">
            <div className="flex flex-col gap-1 border-r border-border pr-3 overflow-y-auto max-h-[50vh]">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => {
                    setDraftNew(null);
                    setSelectedId(team.id);
                  }}
                  className={cn(
                    "text-left rounded-sm px-2 py-1.5 hover:bg-accent/60",
                    !draftNew && selectedId === team.id && "bg-accent",
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
                onClick={() => setDraftNew(newTeam())}
              >
                <Plus /> New team
              </Button>
            </div>

            {selected ? (
              <TeamEditor
                key={selected.id}
                team={selected}
                isNew={!!draftNew}
                onDelete={() => setDeleting(selected)}
                onSave={(next) => {
                  onSave(next);
                  setDraftNew(null);
                  setSelectedId(next.id);
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground self-center text-center">
                No teams yet.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  setSelectedId(null);
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
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[50vh] pr-1">
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

      <div className="space-y-1.5">
        <Label htmlFor="team-members" className="text-xs">
          GitHub logins ({parsed.length})
        </Label>
        <Textarea
          id="team-members"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          spellCheck={false}
          placeholder={"alice\nbob\ncarol"}
          className="min-h-48 text-xs font-mono"
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
