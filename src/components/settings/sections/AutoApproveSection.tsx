// Auto-approve: the ONE sanctioned exception to "the agent never writes to
// GitHub" (invariant §1). It gets its own page rather than a card under the
// agent's other switches specifically so the gates are readable in one glance
// — this is the setting whose blast radius reaches other people's repos.
import { ShieldAlert } from "lucide-react";
import type { TandemSettings } from "../../../shared/settings-types";
import { Note, NumberField, Panel, SectionHeading, ToggleRow } from "../fields";

const GATES = [
  "the pass-3 merge-readiness score is at or above the threshold",
  "there are zero undismissed blocker or risk findings",
  "checks are green (unless that gate is waived below)",
  "the PR is not a draft",
  "you have no pending review of your own in progress on it",
];

export function AutoApproveSection({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const aa = settings.autoApprove;
  const set = (p: Partial<TandemSettings["autoApprove"]>) =>
    onPatch({ autoApprove: { ...aa, ...p } });

  return (
    <>
      <SectionHeading title="Auto-approve">
        The one unattended GitHub write Tandem can make, and only with this
        switch on. Everything else the agent produces is a proposal you submit
        yourself.
      </SectionHeading>

      <Panel>
        <ToggleRow
          label="Auto-approve qualifying PRs"
          hint="Off = the agent never writes to GitHub, ever."
          checked={aa.enabled}
          onChange={(v) => set({ enabled: v })}
        />
      </Panel>

      <Panel
        title="Gates"
        hint="A run auto-approves only when EVERY one holds."
      >
        <ul className="text-xs text-muted-foreground space-y-1 max-w-prose">
          {GATES.map((gate) => (
            <li key={gate} className="flex gap-2">
              <span aria-hidden className="text-foreground/40">
                ·
              </span>
              {gate}
            </li>
          ))}
        </ul>

        <div className="max-w-xs">
          <NumberField
            label="Minimum score (0-100)"
            value={aa.minScore}
            onCommit={(v) => set({ minScore: Math.min(100, v) })}
          />
        </div>

        <ToggleRow
          label="Require checks passing"
          hint="Off waives the third gate — the other four still hold."
          checked={aa.requireChecksPassing}
          onChange={(v) => set({ requireChecksPassing: v })}
        />

        <Note icon={ShieldAlert}>
          An approval posts as you. It is an empty APPROVE — no comment body, no
          findings attached — so a PR that qualifies is one the agent found
          nothing to say about.
        </Note>
      </Panel>
    </>
  );
}
