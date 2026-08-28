// Agent › Review policy: WHEN the agent runs, on what, and how much it may
// spend doing it. What it says once running is the Profiles section; the one
// thing it may write is Auto-approve. Three separate pages because the three
// questions have different blast radii.
import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@uipath/apollo-wind";
import { CircleAlert, CircleCheck, Trash2 } from "lucide-react";
import { useAgentHealth } from "../../../hooks/useAgentHealth";
import { useAgentRuns } from "../../../hooks/useAgentRuns";
import type { TandemSettings } from "../../../shared/settings-types";
import {
  EmptyState,
  FieldGrid,
  FormActions,
  Note,
  NumberField,
  Panel,
  SectionHeading,
  ToggleRow,
} from "../fields";

export function AgentPolicySection({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const runs = useAgentRuns();
  const health = useAgentHealth();

  return (
    <>
      <SectionHeading title="Review policy">
        When the agent runs, which repos it reads, and the size and money caps
        it stops at. Every pass is read-only — nothing here can make the agent
        write to GitHub.
      </SectionHeading>

      <Panel
        title="Claude CLI"
        hint={
          <>
            Every pass — orient, analyze, reconcile, chat — is a headless{" "}
            <code className="font-mono text-[11px]">claude -p</code> one-shot
            run with <code className="font-mono text-[11px]">--safe-mode</code>{" "}
            and no tools. There is no write tool for the agent to reach for, at
            any point.
          </>
        }
      >
        <div className="flex items-center gap-2 text-sm">
          {health.data?.available ? (
            <>
              {/* The design system's reserved status token, same as the
                  queue's check and pulse marks — never a fresh green. */}
              <CircleCheck
                className="size-4"
                style={{ color: "var(--success)" }}
              />
              <span>Available</span>
              <span className="font-mono text-xs text-muted-foreground">
                claude {health.data.version ?? ""}
              </span>
            </>
          ) : health.data ? (
            <>
              <CircleAlert className="size-4 text-destructive" />
              <span>
                Not found on PATH — no run can start, whatever is set below.
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">checking…</span>
          )}
        </div>
      </Panel>

      <Panel title="When it runs">
        <ToggleRow
          label="Run automatically (pre-warm)"
          hint="Off: the agent only runs when you press rerun (r) on a PR. On: PRs entering agent-enabled views are analyzed in the background."
          checked={settings.autoRunEnabled}
          onChange={(v) => onPatch({ autoRunEnabled: v })}
        />
        <ToggleRow
          label="Analyze PRs by default"
          hint="Repos can override below. Applies to manual and automatic runs."
          checked={settings.agentEnabledByDefault}
          onChange={(v) => onPatch({ agentEnabledByDefault: v })}
        />
        <ToggleRow
          label="Skip draft PRs"
          hint="Drafts get a Skipped agent cell instead of an analysis."
          checked={settings.skipDrafts}
          onChange={(v) => onPatch({ skipDrafts: v })}
        />
      </Panel>

      <Panel
        title="Repositories"
        hint="Repos absent from this list follow the default above."
      >
        <RepoOverrides settings={settings} onPatch={onPatch} />
        <Note>
          A <code className="font-mono">.tandem/conventions.md</code> in a repo
          is read into every run — house rules, known deprecations, links to
          postmortems. It's the main quality lever per repo.
        </Note>
      </Panel>

      <Panel
        title="Caps"
        hint="A PR over either size cap is skipped without invoking the model.
        The finding caps are enforced by pass 3 and re-enforced after parsing,
        so a prompt edit can't widen them."
      >
        <FieldGrid cols={4}>
          <NumberField
            label="Max changed files"
            value={settings.maxChangedFiles}
            onCommit={(v) => onPatch({ maxChangedFiles: v })}
          />
          <NumberField
            label="Max diff lines"
            value={settings.maxDiffLines}
            onCommit={(v) => onPatch({ maxDiffLines: v })}
          />
          <NumberField
            label="Finding cap"
            value={settings.findingCap}
            onCommit={(v) => onPatch({ findingCap: v })}
          />
          <NumberField
            label="Nit cap"
            value={settings.nitCap}
            onCommit={(v) => onPatch({ nitCap: v })}
          />
        </FieldGrid>

        <div className="space-y-1.5">
          <Label className="text-xs">Collapse findings below</Label>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={settings.severityThreshold}
            onValueChange={(threshold) => {
              if (
                threshold === "blocker" ||
                threshold === "risk" ||
                threshold === "nit"
              )
                onPatch({ severityThreshold: threshold });
            }}
            className="justify-start"
            aria-label="Severity threshold"
          >
            {(["blocker", "risk", "nit"] as const).map((threshold) => (
              <ToggleGroupItem
                key={threshold}
                value={threshold}
                className="text-xs font-mono"
              >
                {threshold === "nit" ? "show everything" : `${threshold}+`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </Panel>

      <Panel
        title="Budget"
        hint="Runs and chat spend from the same daily ceiling. A
        subscription-billed CLI reports $0, in which case the pane falls back to
        token counts."
        aside={
          <span className="text-xs font-mono text-muted-foreground">
            spent today: ${runs.data?.spendTodayUsd.toFixed(2) ?? "0.00"} / $
            {settings.dailyCostUsd.toFixed(2)}
          </span>
        }
      >
        <div className="max-w-xs">
          <NumberField
            label="Daily cost ceiling (USD)"
            value={settings.dailyCostUsd}
            onCommit={(v) => onPatch({ dailyCostUsd: v })}
          />
        </div>
      </Panel>
    </>
  );
}

function RepoOverrides({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const [newRepo, setNewRepo] = useState("");
  const entries = Object.entries(settings.repos);

  const add = () => {
    const key = newRepo.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(key)) return;
    onPatch({
      repos: {
        ...settings.repos,
        [key]: { agentEnabled: !settings.agentEnabledByDefault },
      },
    });
    setNewRepo("");
  };

  return (
    <div className="space-y-1.5 max-w-2xl">
      {entries.length === 0 ? (
        <EmptyState>None — every repo follows the default.</EmptyState>
      ) : null}
      {entries.map(([repo, { agentEnabled }]) => (
        <div key={repo} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs flex-1 truncate" title={repo}>
            {repo}
          </span>
          <Switch
            checked={agentEnabled}
            onCheckedChange={(v) =>
              onPatch({
                repos: { ...settings.repos, [repo]: { agentEnabled: v } },
              })
            }
          />
          <Button
            size="2xs"
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              const next = { ...settings.repos };
              delete next[repo];
              onPatch({ repos: next });
            }}
          >
            <Trash2 /> Remove
          </Button>
        </div>
      ))}
      <FormActions>
        <Input
          value={newRepo}
          onChange={(e) => setNewRepo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="owner/repo"
          className="h-7 text-xs font-mono flex-1"
        />
        {/* Default variant, per button rule 2 — it is this form's submit, and
            an outline here read as secondary next to identical rows above. */}
        <Button size="xs" onClick={add}>
          Add override
        </Button>
      </FormActions>
    </div>
  );
}
