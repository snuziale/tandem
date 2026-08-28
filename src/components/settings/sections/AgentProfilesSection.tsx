// Agent › Profiles: WHAT the agent says. Each profile carries its own
// per-pass models and prompt blocks, so agents can specialize (security sweep,
// test-coverage, API-contract…). Every run records which one produced it.
//
// This is the widest surface in the app — five prompt blocks and four models —
// which is exactly why it is its own page rather than the fifth card in a
// scroll.
import { useState } from "react";
import { Button, ToggleGroup, ToggleGroupItem } from "@uipath/apollo-wind";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_PROMPTS,
  type PromptTexts,
} from "../../../shared/prompt-defaults";
import {
  DEFAULT_AGENT,
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

  const patchAgent = (patch: Partial<AgentProfile>) => {
    onPatch({
      agents: settings.agents.map((a) =>
        a.id === agent.id ? { ...a, ...patch } : a,
      ),
    });
  };

  const addAgent = () => {
    const id = crypto.randomUUID().slice(0, 8);
    const next: AgentProfile = {
      ...DEFAULT_AGENT,
      id,
      name: "New agent",
      description: undefined,
    };
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
        picked from the PR's rerun menu. Data blocks and the strict-JSON output
        contracts stay code-owned — findings that break the rules are dropped by
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
          <Button size="xs" variant="ghost" onClick={addAgent}>
            <Plus /> New profile
          </Button>
        </div>
      </Panel>

      <Panel title="Identity">
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
            defaultValue={DEFAULT_PROMPTS[key]}
            onCommit={(value) =>
              patchAgent({ prompts: { ...agent.prompts, [key]: value } })
            }
          />
        ))}
      </Panel>
    </>
  );
}
