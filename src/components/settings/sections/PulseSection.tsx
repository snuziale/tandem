/**
 * Pulse: how the queue reads a cohort, and what the menu-bar feed serves.
 *
 * `rottingDays` is here rather than as a constant because it is a team norm,
 * not a fact — a repo shipping twice a day and one shipping monthly disagree
 * about when silence becomes a problem, and every "rotting" mark in the app
 * (rows, drawer, trend, menu bar) is drawn against this one number.
 *
 * It sits under Queue and not under Agent on purpose: pulse invokes no model
 * and spends nothing. It is a reading of the search results the queue already
 * has.
 */
import { useSavedViews } from "../../../hooks/useSavedViews";
import type { TandemSettings } from "../../../shared/settings-types";
import { IS_MAC } from "../../../keyboard/platform";
import {
  Note,
  NumberField,
  Panel,
  SectionHeading,
  SelectField,
  ToggleRow,
} from "../fields";

export function PulseSection({
  settings,
  onPatch,
}: {
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  const views = useSavedViews();
  const pulse = settings.pulse;
  const set = (p: Partial<TandemSettings["pulse"]>) =>
    onPatch({ pulse: { ...pulse, ...p } });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <SectionHeading title="Pulse">
        Whose court the ball is in, for every open PR. One definition drives the
        queue's pulse column, the breakdown, the header pill and the menu-bar
        feed — change it here and all four move together.
      </SectionHeading>

      <Panel title="Staleness">
        <div className="max-w-xs">
          <NumberField
            label="Rotting after (days idle)"
            value={pulse.rottingDays}
            onCommit={(v) => set({ rottingDays: Math.max(1, v) })}
          />
        </div>
      </Panel>

      <Panel
        title="History"
        hint="The sparkline in the queue breakdown is the only trend in the app
        and reads only this. It is written from the queue POLL, so it needs the
        app open at least once that day."
      >
        <ToggleRow
          label="Keep a daily rollup"
          hint="Five integers per view per day in ~/.tandem/pulse.json — enough for the trend line, and nothing more. Off = no history is written."
          checked={pulse.journalEnabled}
          onChange={(v) => set({ journalEnabled: v })}
        />
      </Panel>

      <Panel
        title="Menu bar"
        hint="Tandem serves its own xbar / SwiftBar plugin, so the menu bar
        inherits the team, this staleness line and the pulse rules instead of
        keeping a second copy of all three. It is a read of the same queue — no
        extra token, no team list to maintain twice."
      >
        <div className="max-w-xs">
          <SelectField
            label="Menu-bar view"
            value={pulse.menuViewId ?? ""}
            options={[
              { value: "", label: "All views, merged" },
              ...(views.data ?? []).map((view) => ({
                value: view.id,
                label: view.name,
              })),
            ]}
            onChange={(id) => set({ menuViewId: id || null })}
          />
        </div>

        <div className="space-y-1.5 max-w-2xl">
          <Note>
            Drop a file in your xbar / SwiftBar plugins folder containing:
          </Note>
          <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto">
            {`#!/bin/sh\ncurl -s ${origin}/api/pulse.xbar`}
          </pre>
          <Note>
            Append{" "}
            <code className="font-mono text-[10px]">?team=&lt;name&gt;</code> or{" "}
            <code className="font-mono text-[10px]">?group=author</code> to
            override per plugin.
          </Note>
          {!IS_MAC && (
            <Note>
              Those two hosts are macOS-only. The endpoint is not — it answers
              plain text to any client, so on Windows or Linux read it with{" "}
              <code className="font-mono text-[10px]">curl</code> or{" "}
              <code className="font-mono text-[10px]">Invoke-RestMethod</code>;
              there is simply no menu bar to hang it in.
            </Note>
          )}
        </div>
      </Panel>
    </>
  );
}
