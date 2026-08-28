// The dialog frame around TeamsPanel. Teams themselves live in
// Settings › Teams — this exists for ONE path: the view editor, where you
// discover mid-query that the team you want to point `{team}` at doesn't
// exist yet. Navigating to settings there would throw away the half-written
// view, so the same panel opens over it instead.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uipath/apollo-wind";
import type { Team } from "../../shared/team-types";
import { TeamsPanel, TeamTokenBlurb } from "../teams/TeamsPanel";

export function TeamManagerDialog({
  teams,
  onClose,
  onSave,
  onDelete,
}: {
  teams: Team[];
  onClose: () => void;
  onSave: (team: Team) => void;
  onDelete: (id: string) => void;
}) {
  // Mounted only while open (like DeleteViewDialog beside it), so openness is
  // the caller's `{cond ? … : null}` rather than a prop that can disagree.
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      {/* `sm:max-w-*`, not `max-w-*`: apollo's DialogContent already carries
          `sm:max-w-lg`, and a responsive variant wins the cascade over a
          plain utility no matter what order they are written in. */}
      <DialogContent className="sm:max-w-3xl w-[min(48rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Teams</DialogTitle>
          <DialogDescription>
            <TeamTokenBlurb />
          </DialogDescription>
        </DialogHeader>

        <TeamsPanel
          teams={teams}
          onSave={onSave}
          onDelete={onDelete}
          className="min-h-72 max-h-[50vh]"
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
