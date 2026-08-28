// Views — the read-and-round-trip half. Creating, renaming, editing and
// deleting a view stays on its TAB (settled decision): a view is edited where
// it is used. What lives here is the part that was never about the queue you
// happen to be looking at — the JSON that ships views AND teams to a
// teammate, and an overview of what is configured, which the tab strip can
// only show 12 characters of at a time.
import { useState } from "react";
import { Button, Textarea, toast } from "@uipath/apollo-wind";
import { ArrowRight, Users } from "lucide-react";
import { useSavedViews, useViewActions } from "../../../hooks/useSavedViews";
import { useTeamActions, useTeams } from "../../../hooks/useTeams";
import { hasTeamToken } from "../../../shared/gh/team";
import {
  formatConfigJson,
  parseConfigJson,
  type TandemConfig,
} from "../../../utils/configJson";
import { EmptyState, Panel, SectionHeading } from "../fields";

export function ViewsSection() {
  const viewsQuery = useSavedViews();
  const views = viewsQuery.data ?? [];
  const teamsQuery = useTeams();
  const teams = teamsQuery.data ?? [];
  const viewActions = useViewActions(views, null);
  const teamActions = useTeamActions(teams);

  return (
    <>
      <SectionHeading title="Views">
        One saved GitHub search each, run in parallel on every poll. Rename,
        edit and delete live on the tab itself — right-click it, or use its ⋯
        menu — because a view is edited where it is read.
      </SectionHeading>

      <Panel
        title={`Configured views (${views.length})`}
        hint="The badge on a tab is GitHub's total match count; the table
        always shows the first 50."
      >
        {views.length === 0 ? (
          <EmptyState>
            None yet — add one with the + on the queue's tab strip.
          </EmptyState>
        ) : (
          <div className="divide-y divide-border">
            {views.map((view) => {
              const team = teams.find((t) => t.id === view.teamId);
              const usesTeam = hasTeamToken(view.query);
              return (
                <div
                  key={view.id}
                  className="flex items-baseline gap-3 py-2 first:pt-0"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-sm flex items-center gap-2">
                      {view.name}
                      {view.agentEnabled ? (
                        <span
                          className="text-[10px] uppercase tracking-wide"
                          style={{ color: "var(--tandem-agent)" }}
                        >
                          agent
                        </span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {view.query}
                    </div>
                  </div>
                  {usesTeam ? (
                    <span
                      className={
                        "text-[11px] font-mono flex items-center gap-1 shrink-0 " +
                        (team ? "text-muted-foreground" : "text-destructive")
                      }
                    >
                      <Users className="size-3" />
                      {/* A `{team}` token with nothing behind it fails the
                          search loudly rather than matching everything — say
                          so here too, before the queue has to. */}
                      {team ? team.name : "no team attached"}
                    </span>
                  ) : null}
                  <Button
                    size="2xs"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => viewActions.select(view.id)}
                  >
                    Open <ArrowRight />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <ConfigJsonPanel
        json={formatConfigJson(views, teams)}
        onApply={(config) => {
          viewActions.replaceAll(config.views);
          // Null means the payload never mentioned teams (an old views-only
          // export) — leave the ones already configured alone.
          if (config.teams) teamActions.replaceAll(config.teams);
        }}
      />
    </>
  );
}

/**
 * Views and teams as one document, because a view carries a `teamId` and not a
 * list of logins: shipping one without the other hands the reader a view that
 * refuses to search.
 */
function ConfigJsonPanel({
  json,
  onApply,
}: {
  json: string;
  onApply: (config: TandemConfig) => void;
}) {
  const [draft, setDraft] = useState(json);
  const [serverJson, setServerJson] = useState(json);
  const [error, setError] = useState<string | null>(null);
  // Follow the server while the box is untouched — a view renamed on the tab
  // must not leave a stale document sitting here looking authoritative.
  const dirty = draft !== serverJson;
  if (json !== serverJson && !dirty) {
    setServerJson(json);
    setDraft(json);
  }

  const apply = () => {
    const parsed = parseConfigJson(draft);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    onApply(parsed);
    setError(null);
    toast.success("Configuration applied");
  };

  return (
    <Panel
      title="Import / export"
      hint={
        <>
          The views in{" "}
          <code className="font-mono text-[11px]">~/.tandem/views.json</code>{" "}
          and the teams in{" "}
          <code className="font-mono text-[11px]">~/.tandem/teams.json</code>.
          Copy it to share; paste a teammate's to import. Applying replaces ALL
          views, and all teams when the payload lists any.
        </>
      }
      aside={
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setDraft(serverJson);
                setError(null);
              }}
            >
              Revert
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(draft)
                .then(() => toast.success("Configuration copied"));
            }}
          >
            Copy JSON
          </Button>
          <Button size="xs" disabled={!dirty} onClick={apply}>
            Apply
          </Button>
        </div>
      }
    >
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
    </Panel>
  );
}
