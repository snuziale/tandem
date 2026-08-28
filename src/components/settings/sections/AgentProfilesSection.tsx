// Agent › Profiles: WHAT the agent says. Each profile carries its own
// per-pass models and prompt blocks, so agents can specialize (security sweep,
// test-coverage, API-contract…). Every run records which one produced it.
//
// This is the widest surface in the app — five prompt blocks and four models —
// which is exactly why it is its own page rather than the fifth card in a
// scroll.
import { useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@uipath/apollo-wind";
import { Plus, Trash2 } from "lucide-react";
import {
  AGENT_PRESETS,
  presetById,
  profileFromPreset,
  promptsFromPreset,
  type AgentPreset,
} from "../../../shared/agent-presets";
import {
  DEFAULT_PROMPTS,
  type PromptTexts,
} from "../../../shared/prompt-defaults";
import {
  DEFAULT_AGENT,
  agentById,
  type AgentProfile,
  type TandemSettings,
} from "../../../shared/settings-types";
import {
  FieldGrid,
  Panel,
  PromptField,
  SectionHeading,
  TextField,
} from "../fields";

const PROMPT_BLOCKS: Array<[keyof PromptTexts, string, string]> = [
  ["rules", "Review rules", "Injected into the analyze and reconcile passes."],
  ["orient", "Pass 1 · orient", "Produces the review plan from PR metadata."],
  [
    "analyze",
    "Pass 2 · analyze",
    "Runs once per file cluster with the diffs in context.",
  ],
  [
    "reconcile",
    "Pass 3 · reconcile",
    "Dedupes, ranks, caps, scores. {findingCap} and {nitCap} interpolate from the caps in Review policy.",
  ],
  [
    "chat",
    "Chat",
    "How it talks to you in the pane, and how it proposes edits to its own findings and your staged comments. The action contract itself is code-owned.",
  ],
];

export function AgentProfilesSection({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const [editingId, setEditingId] = useState(settings.defaultAgentId);
  // Never undefined: sanitizeAgents guarantees at least one profile, and the
  // fallback covers a profile deleted out from under `editingId`.
  const agent =
    settings.agents.find((a) => a.id === editingId) ?? settings.agents[0];
  const preset = presetById(agent.presetId);
  const promptDefaults = preset ? promptsFromPreset(preset) : DEFAULT_PROMPTS;

  const patchAgent = (patch: Partial<AgentProfile>) => {
    onPatch({
      agents: settings.agents.map((a) =>
        a.id === agent.id ? { ...a, ...patch } : a,
      ),
    });
  };

  // A preset is COPIED, never referenced: from here on the text belongs to
  // the profile, so tuning it is tuning this profile and an app upgrade never
  // rewrites a prompt someone edited. Models come from the CONFIGURED default
  // profile rather than the shipped constant — a lens changes what to look at,
  // so it should start on whatever the user's general reviewer already runs.
  // Names are free to collide: `id` is the identity everywhere.
  const addAgent = (starter?: AgentPreset) => {
    const id = crypto.randomUUID().slice(0, 8);
    const models = agentById(settings, settings.defaultAgentId).models;
    const next: AgentProfile = starter
      ? profileFromPreset(starter, id, models)
      : { ...DEFAULT_AGENT, id, name: "New agent", description: undefined };
    onPatch({ agents: [...settings.agents, next] });
    setEditingId(id);
  };

  const deleteAgent = () => {
    if (settings.agents.length <= 1) return;
    const remaining = settings.agents.filter((a) => a.id !== agent.id);
    onPatch({
      agents: remaining,
      defaultAgentId:
        settings.defaultAgentId === agent.id
          ? remaining[0].id
          : settings.defaultAgentId,
    });
    setEditingId(remaining[0].id);
  };

  return (
    <>
      <SectionHeading title="Agent profiles">
        Reviewer profiles: each has its own models and prompt blocks. The
        default (★) runs automatically and on a plain rerun; any profile can be
        picked from the PR's rerun menu. New profile starts from a LENS —
        correctness, architecture, React or performance — which is the shared
        review rules plus what that reviewer looks at; every block stays
        editable afterwards. Data blocks and the strict-JSON output contracts
        stay code-owned — findings that break the rules are dropped by
        validation regardless of prompt edits.
      </SectionHeading>

      <Panel
        title="Profiles"
        hint="Pick the one you are editing. The three panels below always
        describe the selected profile."
        aside={
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={settings.defaultAgentId === agent.id}
              onClick={() => onPatch({ defaultAgentId: agent.id })}
            >
              Make default
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="text-destructive"
              disabled={settings.agents.length <= 1}
              onClick={deleteAgent}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={agent.id}
            onValueChange={(id) => id && setEditingId(id)}
            aria-label="Agent profile"
          >
            {settings.agents.map((a) => (
              <ToggleGroupItem
                key={a.id}
                value={a.id}
                className="text-xs font-mono"
              >
                {a.name}
                {a.id === settings.defaultAgentId ? " ★" : ""}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost">
                <Plus /> New profile
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-sm">
              {AGENT_PRESETS.map((starter) => (
                <DropdownMenuItem
                  key={starter.id}
                  onSelect={() => addAgent(starter)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="text-xs font-medium">{starter.name}</span>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {starter.description}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => addAgent()}>
                <span className="text-xs">Blank profile</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Panel>

      <Panel
        title="Identity"
        hint={
          preset
            ? `Started from the ${preset.name} preset — a prompt block's "reset to default" returns to that lens, not to the general reviewer's text.`
            : undefined
        }
      >
        <FieldGrid>
          <TextField
            label="Name"
            value={agent.name}
            onCommit={(v) => patchAgent({ name: v })}
          />
          <TextField
            label="Description"
            value={agent.description ?? ""}
            onCommit={(v) => patchAgent({ description: v || undefined })}
            allowEmpty
          />
        </FieldGrid>
      </Panel>

      <Panel
        title="Models"
        hint="One per pass. Orient is cheap and degrades to a generic plan if it
        fails; chat is the one a reviewer waits on, so it wants prose speed, not
        just strict JSON."
      >
        <FieldGrid cols={4}>
          {(["orient", "analyze", "reconcile", "chat"] as const).map((pass) => (
            <TextField
              key={`${agent.id}-${pass}`}
              label={`${pass} model`}
              value={agent.models[pass]}
              onCommit={(v) =>
                patchAgent({ models: { ...agent.models, [pass]: v } })
              }
            />
          ))}
        </FieldGrid>
      </Panel>

      <Panel title="Prompts">
        {PROMPT_BLOCKS.map(([key, label, hint]) => (
          <PromptField
            key={`${agent.id}-${key}`}
            label={label}
            hint={hint}
            value={agent.prompts[key]}
            defaultValue={promptDefaults[key]}
            onCommit={(value) =>
              patchAgent({ prompts: { ...agent.prompts, [key]: value } })
            }
          />
        ))}
      </Panel>
    </>
  );
}
