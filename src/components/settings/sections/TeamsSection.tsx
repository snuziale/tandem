// Teams — moved out of the queue header's ⋯ button (2026-08-27). A team is a
// durable claim about PEOPLE that several views and the menu-bar feed all read
// from; it is configuration, not a thing you do to the queue you're looking at.
import { useTeamActions, useTeams } from "../../../hooks/useTeams";
import { TeamsPanel, TeamTokenBlurb } from "../../teams/TeamsPanel";
import { Note, Panel, SectionHeading } from "../fields";

/** The panel keeps ONE height whether or not the list has arrived, so the page
 * does not jump when it does. */
const PANEL_HEIGHT = "h-[26rem]";

export function TeamsSection() {
  const teamsQuery = useTeams();
  const teams = teamsQuery.data;
  const actions = useTeamActions(teams);

  return (
    <>
      <SectionHeading title="Teams">
        <TeamTokenBlurb />
      </SectionHeading>

      <Panel>
        {/* Mounted only once the list has LOADED: the panel seeds a blank
            "new team" draft when it opens on an empty list, and an
            still-loading query is not an empty list. */}
        {teams ? (
          <TeamsPanel
            teams={teams}
            onSave={actions.upsert}
            onDelete={actions.remove}
            className={PANEL_HEIGHT}
          />
        ) : (
          <div className={PANEL_HEIGHT} />
        )}
        <Note>
          A team-backed view is searched in chunks of 8 logins, one parallel
          search each — that is how a 25-person team gets full coverage without
          raising the page size. A team with no members is an error rather than
          a query: an empty expansion would search all of GitHub.
        </Note>
      </Panel>
    </>
  );
}
