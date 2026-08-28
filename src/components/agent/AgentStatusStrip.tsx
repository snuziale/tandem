import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
  toast,
} from "@uipath/apollo-wind";
import { MessageSquare, Square } from "lucide-react";
import { cancelRun } from "../../api/runs";
import { useAgentHealth } from "../../hooks/useAgentHealth";
import { useAgentActivity } from "../../hooks/useAgentActivity";
import { useAgentRuns } from "../../hooks/useAgentRuns";
import { useSettings } from "../../hooks/useSettings";
import { navigate, navigateToSettings } from "../../routes";
import type { TodayTally } from "../../shared/agent-activity";
import {
  SKIP_REASON_LABEL,
  isActiveRun,
  type AgentRun,
  type LiveWork,
} from "../../shared/agent-types";
import { parsePrId } from "../../shared/gh/prKey";

import {
  fileNames,
  formatDuration,
  formatSpend,
  shortPrRef,
} from "../../utils/agentFormat";

/**
 * The header's agent readout: a strip that ANIMATES while work is in flight,
 * and a tray behind it that says where the agent is and what it is reading.
 *
 * It replaced a dot and the words "2 running", which spent ~90px to render one
 * bit out of a data model that already carries the rest — every run persists
 * `steps[]`, and a pass-2 step names the very files being read. That was the
 * information; it just had nowhere to go.
 *
 * Two rules hold this in the header's fixed-height row:
 *
 * - **The trigger's width never changes with its content.** It is the leftmost
 *   thing in the app-level zone, so a strip that grew with a longer step label
 *   would slide the ⚙ and the theme toggle sideways every few seconds. Fixed
 *   width, and every line inside truncates.
 * - **Detail goes in the tray, not the header.** One click, not a second row.
 */
export function AgentStatusStrip() {
  const activity = useAgentActivity();
  const live = activity.data?.work ?? [];
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Agent activity"
              className="w-[168px] shrink-0 rounded-sm px-1.5 py-0.5 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {live.length > 0 ? (
                <LiveHeadline live={live} />
              ) : (
                <IdleHeadline today={activity.data?.today} />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>
            {live.length > 0
              ? `${live.length} in flight — click for detail`
              : "Agent activity"}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <PopoverContent align="end" className="w-[380px] p-0">
        <AgentTray onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The header trigger

/**
 * The live face: pass segments over a moving comet, and one line naming the
 * work. `live` is newest-first, so the strip follows whatever started last and
 * the rest are counted rather than cycled — a rotating label in permanent
 * chrome is a thing you have to WAIT for to read.
 */
function LiveHeadline({ live }: { live: LiveWork[] }) {
  const lead = live[0];
  const others = live.length - 1;
  return (
    <div className="flex flex-col gap-1">
      <PassTrack pass={lead.kind === "chat" ? undefined : lead.pass} />
      <div
        className="flex items-baseline gap-1 text-[10px] font-mono leading-none"
        style={{ color: "var(--tandem-agent)" }}
      >
        <span className="truncate">{lead.label}</span>
        <span className="flex-1" />
        <span className="shrink-0 opacity-70 tabular-nums">
          {others > 0 ? `+${others}` : shortPrRef(lead.prId)}
        </span>
      </div>
    </div>
  );
}

/**
 * Idle earns its space too: what the agent did today, rather than the word
 * "idle" and 90px of nothing. Static on purpose — motion in the header is
 * reserved for work actually happening.
 */
function IdleHeadline({ today }: { today: TodayTally | undefined }) {
  const parts = [
    `${today?.runs ?? 0} today`,
    today?.openFindings ? `${today.openFindings} open` : null,
    today?.failed ? `${today.failed} failed` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 h-1">
        <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
        <span className="h-px flex-1 bg-muted-foreground/15" />
      </div>
      <div className="flex items-baseline gap-1.5 text-[10px] font-mono leading-none text-muted-foreground">
        <span className="shrink-0">idle</span>
        <span className="truncate opacity-80">{parts.join(" · ")}</span>
      </div>
    </div>
  );
}

/**
 * Three segments, one per pipeline pass. Passes already done are filled, the
 * current one carries the comet, later ones are empty track.
 *
 * Deliberately NOT a percentage bar: each pass answers with a single strict
 * JSON blob, so there is no measurable fraction inside one — a bar that jumped
 * 0 → 33 → 90 would be inventing progress. Which pass, plus visible motion, is
 * everything that is actually known.
 *
 * `pass` undefined = a chat turn or a run before pass 1 (fetching): the whole
 * track becomes one lane and the comet runs its full width.
 */
function PassTrack({ pass }: { pass?: 1 | 2 | 3 }) {
  const lanes: (1 | 2 | 3)[] = [1, 2, 3];
  if (pass === undefined) {
    return (
      <div className="flex h-1 gap-px">
        <Lane state="active" />
      </div>
    );
  }
  return (
    <div className="flex h-1 gap-px" aria-hidden>
      {lanes.map((lane) => (
        <Lane
          key={lane}
          state={lane < pass ? "done" : lane === pass ? "active" : "pending"}
        />
      ))}
    </div>
  );
}

function Lane({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done")
    return (
      <span
        className="flex-1 rounded-full"
        style={{ background: "var(--tandem-agent-dim)" }}
      />
    );
  if (state === "pending")
    return <span className="flex-1 rounded-full bg-muted-foreground/20" />;
  return (
    <span
      className="relative flex-1 overflow-hidden rounded-full"
      style={{ background: "var(--tandem-agent-bg)" }}
    >
      {/* Two sweeps of the same comet, one a beat behind, so the lane reads as
          a trail. `motion-safe` only — reduced motion keeps the dim fill,
          which still says "this lane is the live one". */}
      <span className="absolute inset-0 hidden motion-safe:block">
        <span className="tandem-comet absolute inset-y-0 left-0 w-1/3 rounded-full" />
        <span className="tandem-comet tandem-comet--trail absolute inset-y-0 left-0 w-1/3 rounded-full" />
      </span>
      <span
        className="absolute inset-0 motion-safe:hidden"
        style={{ background: "var(--tandem-agent-dim)" }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The tray

function AgentTray({ onNavigate }: { onNavigate: () => void }) {
  const settings = useSettings();
  const health = useAgentHealth();
  const activity = useAgentActivity();
  // The history list is the ONE thing here that wants the full run records —
  // and it is only mounted while the popover is open, so the heavy query is
  // read at its own slow cadence rather than driving the strip's.
  const runs = useAgentRuns();
  const live = activity.data?.work ?? [];
  // `work` already absorbed every ACTIVE run — queued ones included — so
  // "recent" is simply everything that is not active. Filtering on the live
  // registry alone put a run that was genuinely `analyzing` under "recent",
  // summarized as though it had finished with nothing to flag.
  const liveIds = new Set(live.map((work) => work.id));
  const recent = [...(runs.data?.byKey.values() ?? [])]
    .filter((r) => !isActiveRun(r) && !liveIds.has(r.id))
    .sort((a, b) => finishedAt(b) - finishedAt(a))
    .slice(0, 6);

  const ceiling = settings.data?.dailyCostUsd;
  const spent = activity.data?.spendTodayUsd ?? 0;

  return (
    <div className="text-xs">
      <div className="flex items-baseline gap-2 border-b border-border px-3 py-2">
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--tandem-agent)" }}
        >
          ● agent
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          ${spent.toFixed(2)}
          {ceiling ? ` / $${ceiling.toFixed(2)} today` : " today"}
        </span>
      </div>

      {health.data && !health.data.available ? (
        <div className="border-b border-border px-3 py-2 text-[11px] text-destructive">
          claude CLI not found — no run can start.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              onNavigate();
              navigateToSettings("agent");
            }}
          >
            Settings
          </button>
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto">
        {live.length > 0 ? (
          <Section label={`in flight · ${live.length}`}>
            {live.map((work) => (
              <LiveRow key={work.id} work={work} onNavigate={onNavigate} />
            ))}
          </Section>
        ) : null}

        {live.length === 0 ? (
          <div className="px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Nothing running.{" "}
            {settings.data?.autoRunEnabled
              ? "New commits in an agent-enabled view start a run automatically."
              : "Runs are manual — open a PR and press r."}
          </div>
        ) : null}

        {recent.length > 0 ? (
          <Section label="recent">
            {recent.map((run) => (
              <RunRow key={run.id} run={run} onNavigate={onNavigate} />
            ))}
          </Section>
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-1.5">
        <button
          type="button"
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          onClick={() => {
            onNavigate();
            navigateToSettings("agent");
          }}
        >
          agent settings
        </button>
      </div>
    </div>
  );
}

/** Newest activity first, whether the run finished or only ever started. */
function finishedAt(run: AgentRun): number {
  const at = run.finishedAt ?? run.startedAt;
  return at ? +new Date(at) : 0;
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 py-1 last:border-b-0">
      <div className="px-3 pb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/** One thing in flight. Its cancel button is the same route the pane's is —
 * runs are server-owned, so this is a real kill switch and not a UI state. */
function LiveRow({
  work,
  onNavigate,
}: {
  work: LiveWork;
  onNavigate: () => void;
}) {
  const queryClient = useQueryClient();
  const now = useNow();
  const cancel = useMutation({
    mutationFn: () => cancelRun(work.id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      // The registry had no such run: this row came from a run record left
      // `analyzing` by a process that died. Nothing to kill, and the sweep
      // that reconciles those runs happens at server start — say so rather
      // than leave a button that appears to do nothing.
      if (!result.ok)
        toast.info("Nothing to cancel", {
          description:
            "That run is no longer streaming — restart the server to clear it.",
        });
    },
    onError: (e) =>
      toast.error("Could not cancel", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });
  const elapsed = formatDuration(now - +new Date(work.startedAt));
  const names = fileNames(work.paths);

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 hover:bg-accent/50">
      <span className="mt-1 flex-none">
        {work.kind === "chat" ? (
          <MessageSquare
            className="tandem-breathe size-3"
            style={{ color: "var(--tandem-agent)" }}
          />
        ) : (
          <span
            className="tandem-breathe inline-block size-2 rounded-full"
            style={{ background: "var(--tandem-agent)" }}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <PrLink prId={work.prId} onNavigate={onNavigate} />
          <span className="flex-1" />
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {elapsed} · {formatSpend(work)}
          </span>
        </div>
        <div className="truncate font-mono text-[11px]">
          <span style={{ color: "var(--tandem-agent)" }}>
            {work.kind === "chat" ? "chat" : `pass ${work.pass ?? "—"}`}
          </span>
          <span className="text-muted-foreground"> · {work.label}</span>
        </div>
        {names ? (
          // The whole point of the tray: not "busy", but which of YOUR files
          // it has open right now.
          <div
            className="truncate text-[10px] text-muted-foreground/70"
            title={work.paths?.join("\n")}
          >
            {names}
          </div>
        ) : null}
        {work.agentName ? (
          <div className="truncate text-[10px] text-muted-foreground/60">
            {work.agentName}
          </div>
        ) : null}
      </div>
      {work.kind === "run" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="2xs"
              icon
              variant="ghost"
              aria-label="Cancel run"
              className="invisible group-hover:visible"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <Square />
            </Button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Cancel run</TooltipContent>
          </TooltipPortal>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** A finished (or queued) run: outcome, score, what it flagged. */
function RunRow({
  run,
  onNavigate,
}: {
  run: AgentRun;
  onNavigate: () => void;
}) {
  const open = run.findings.filter(
    (f) => f.state === "proposed" || f.state === "edited",
  );
  const blockers = open.filter((f) => f.severity === "blocker").length;
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-accent/50">
      <span className="mt-0.5 flex-none">
        <StatusDot run={run} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <PrLink prId={run.prId} onNavigate={onNavigate} />
          <span className="flex-1" />
          {run.score !== undefined ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {run.score}/100
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {runSummaryLine(run, open.length, blockers)}
        </div>
      </div>
    </div>
  );
}

function runSummaryLine(
  run: AgentRun,
  openCount: number,
  blockers: number,
): string {
  if (run.status === "queued") return "waiting for a slot";
  if (run.status === "failed") return `failed · ${run.error ?? "unknown"}`;
  if (run.status === "skipped")
    return `skipped · ${run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : "not analyzed"}`;
  if (run.status === "stale") return "stale · new commits since";
  const findings = openCount === 0 ? "nothing to flag" : `${openCount} open`;
  return blockers > 0 ? `${findings} · ${blockers} blocker` : findings;
}

function StatusDot({ run }: { run: AgentRun }) {
  const color =
    run.status === "failed"
      ? "bg-destructive"
      : run.status === "ready"
        ? "bg-emerald-400"
        : run.status === "stale"
          ? "bg-yellow-400"
          : "bg-muted-foreground/40";
  return <span className={cn("inline-block size-2 rounded-full", color)} />;
}

function PrLink({
  prId,
  onNavigate,
}: {
  prId: string;
  onNavigate: () => void;
}) {
  const ref = parsePrId(prId);
  return (
    <button
      type="button"
      className="min-w-0 truncate text-left text-[11px] font-medium hover:underline"
      title={prId}
      disabled={!ref}
      onClick={() => {
        if (!ref) return;
        onNavigate();
        navigate({ name: "pr", prId, ...ref });
      }}
    >
      {shortPrRef(prId)}
    </button>
  );
}

/** Ticking clock for the live elapsed readouts. Only mounted while the tray
 * is open, so it stops the moment the popover closes. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
