import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
  toast,
} from "@uipath/apollo-wind";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { AgentSpinner } from "./AgentSpinner";
import { startRun } from "../../api/runs";
import {
  SKIP_REASON_LABEL,
  type AgentRun,
  type Finding,
  type RunStep,
  type Severity,
} from "../../shared/agent-types";
import type { RunProgress } from "../../hooks/useRunStream";
import type { TandemSettings } from "../../shared/settings-types";
import { useUiStore } from "../../state/uiStore";
import { formatDuration, formatSpend } from "../../utils/agentFormat";
import { Markdown } from "../common/Markdown";
import { Shortcut } from "../common/Kbd";
import { ChatPanel } from "./ChatPanel";
import { SeverityBadge } from "./SeverityBadge";

type Props = {
  prId: string;
  /** The sha the pane is showing — chat is scoped to it, run or no run. */
  headSha: string;
  run: AgentRun | undefined;
  progress: RunProgress | null;
  settings: TandemSettings | undefined;
  onSelectFinding: (finding: Finding) => void;
};

const SEVERITY_ORDER: Severity[] = [
  "blocker",
  "risk",
  "nit",
  "question",
  "praise",
];

// The right-hand agent pane (spec §3.2): run status, prose summary, severity
// tally, findings grouped Must resolve / Worth raising / Nits.
export function AgentPane({
  prId,
  headSha,
  run,
  progress,
  settings,
  onSelectFinding,
}: Props) {
  const queryClient = useQueryClient();
  const focusedFindingId = useUiStore((s) => s.focusedFindingId);
  const chatOpen = useUiStore((s) => s.prChatOpen);
  const setChatOpen = useUiStore((s) => s.setPrChatOpen);
  const [showNits, setShowNits] = useState(false);

  const rerun = useMutation({
    mutationFn: (agentId?: string) => startRun(prId, true, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
    onError: (e) =>
      toast.error("Could not start run", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });
  const agents = settings?.agents ?? [];

  const triage = (run?.findings ?? []).filter(
    (f) => f.state === "proposed" || f.state === "edited",
  );
  const threshold = settings?.severityThreshold ?? "risk";
  const collapsed = triage.filter((f) => belowThreshold(f.severity, threshold));
  const visible = triage.filter((f) => !belowThreshold(f.severity, threshold));
  const mustResolve = visible.filter((f) => f.severity === "blocker");
  const worthRaising = visible.filter((f) => f.severity !== "blocker");
  // The conversation follows the pane's focus: a focused finding narrows it.
  const chatFinding =
    run?.findings.find((f) => f.id === focusedFindingId) ?? null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
        <span
          className="text-[10px] uppercase tracking-wider font-mono"
          style={{ color: "var(--tandem-agent)" }}
        >
          ● agent
        </span>
        <span className="flex-1" />
        <Button
          size="2xs"
          icon
          variant="ghost"
          aria-label={chatOpen ? "Hide chat" : "Show chat"}
          aria-pressed={chatOpen}
          onClick={() => setChatOpen((open) => !open)}
        >
          <MessageSquare />
        </Button>
        <Button
          size="2xs"
          variant="ghost"
          disabled={rerun.isPending || isActive(run)}
          onClick={() => rerun.mutate(undefined)}
        >
          rerun <Shortcut keys="r" className="ml-1 opacity-70" />
        </Button>
        {agents.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="2xs"
                icon
                variant="ghost"
                aria-label="Run with a specific agent"
                disabled={rerun.isPending || isActive(run)}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {agents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => rerun.mutate(agent.id)}
                >
                  <span className="text-xs">
                    Run with {agent.name}
                    {agent.id === settings?.defaultAgentId ? " (default)" : ""}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <StatusCard
          run={run}
          progress={progress}
          onStart={() => rerun.mutate(undefined)}
          starting={rerun.isPending}
        />

        {run?.status === "ready" ? (
          <>
            {run.summary ? (
              <Markdown className="px-3 pt-1 pb-2 text-muted-foreground leading-relaxed">
                {run.summary}
              </Markdown>
            ) : null}

            {triage.length > 0 ? (
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {SEVERITY_ORDER.map((severity) => (
                  <SeverityBadge
                    key={severity}
                    severity={severity}
                    count={triage.filter((f) => f.severity === severity).length}
                  />
                ))}
              </div>
            ) : (
              <div className="px-3 pb-3 text-sm">
                <div className="font-medium">Nothing to flag</div>
                <div className="text-muted-foreground text-xs mt-0.5">
                  The agent read the diff and has nothing worth your time.
                </div>
              </div>
            )}

            <FindingGroup
              label="must resolve"
              findings={mustResolve}
              focusedFindingId={focusedFindingId}
              onSelect={onSelectFinding}
            />
            <FindingGroup
              label="worth raising"
              findings={worthRaising}
              focusedFindingId={focusedFindingId}
              onSelect={onSelectFinding}
            />

            {collapsed.length > 0 ? (
              <div className="px-3 py-2 border-t border-border/60">
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNits((v) => !v)}
                >
                  nits · {collapsed.length} hidden ·{" "}
                  {showNits ? "hide" : "show"}
                </button>
                {showNits ? (
                  <div className="mt-1">
                    {collapsed.map((f) => (
                      <FindingRow
                        key={f.id}
                        finding={f}
                        focused={f.id === focusedFindingId}
                        onSelect={onSelectFinding}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Nits stay collapsed below your{" "}
                    <span className="font-mono">{threshold}</span> threshold.
                    Change it in settings.
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {chatOpen ? (
        // Sized by its own content up to half the pane: an empty conversation
        // must not steal height from the findings it is about.
        <div className="flex flex-col min-h-0 max-h-[50%] border-t border-border shrink-0">
          <ChatPanel
            key={chatFinding?.id ?? "pr"}
            prId={prId}
            headSha={headSha}
            finding={chatFinding}
            onClearScope={() => useUiStore.getState().setFocusedFinding(null)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="border-t border-border px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setChatOpen(true)}
        >
          ● chat{chatFinding ? " about this finding" : ""}{" "}
          <span className="opacity-60">c</span>
        </button>
      )}
    </div>
  );
}

function isActive(run: AgentRun | undefined): boolean {
  return (
    !!run &&
    (run.status === "queued" ||
      run.status === "fetching" ||
      run.status === "analyzing")
  );
}

function belowThreshold(
  severity: Severity,
  threshold: "blocker" | "risk" | "nit",
): boolean {
  if (threshold === "nit") return false;
  if (severity === "nit" || severity === "praise") return true;
  if (threshold === "blocker") return severity !== "blocker";
  return false;
}

function StatusCard({
  run,
  progress,
  onStart,
  starting,
}: {
  run: AgentRun | undefined;
  progress: RunProgress | null;
  onStart: () => void;
  starting: boolean;
}) {
  if (!run) {
    return (
      <div className="px-3 py-2">
        <Button
          size="xs"
          variant="outline"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? "Starting…" : "Run agent"}
        </Button>
      </div>
    );
  }

  if (isActive(run)) return <ActiveCard run={run} progress={progress} />;

  if (run.status === "stale" || run.status === "failed") {
    return (
      <div className="px-3 py-2 space-y-1.5">
        {run.status === "stale" ? (
          <div className="text-xs text-yellow-400 font-mono">
            new commits — findings below are stale
          </div>
        ) : (
          <div className="text-xs text-destructive font-mono break-words">
            run failed: {run.error}
          </div>
        )}
        <Button
          size="xs"
          variant="outline"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? "Starting…" : "Rerun agent"}
        </Button>
        {/* Open by default when it failed: which step died is the whole story. */}
        <RunLog run={run} defaultOpen={run.status === "failed"} />
      </div>
    );
  }

  if (run.status === "skipped") {
    return (
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-sm text-muted-foreground">
          Skipped ·{" "}
          {run.skipReason ? SKIP_REASON_LABEL[run.skipReason] : "not analyzed"}
        </div>
        <RunLog run={run} />
      </div>
    );
  }

  // ready
  const duration =
    run.startedAt && run.finishedAt
      ? formatDuration(+new Date(run.finishedAt) - +new Date(run.startedAt))
      : null;
  return (
    <div className="px-3 py-2 space-y-1">
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
        <span className="text-emerald-400">● review ready</span>
        {run.score !== undefined ? (
          <span className="text-foreground/80">score {run.score}/100</span>
        ) : null}
        <span className="flex-1" />
        <span>
          {run.headSha.slice(0, 7)}
          {duration ? ` · ${duration}` : ""} · {formatSpend(run)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
        {run.agentName ? <span>{run.agentName}</span> : null}
        {run.autoApproved ? (
          <span className="text-emerald-400">✓ auto-approved</span>
        ) : null}
      </div>
      <RunLog run={run} />
    </div>
  );
}

/**
 * A run in flight. The plan and the step timeline are the feedback: the passes
 * emit one strict-JSON blob each, so there is no prose to stream — but what the
 * agent is looking for, and which files it is reading right now, are knowable.
 */
function ActiveCard({
  run,
  progress,
}: {
  run: AgentRun;
  progress: RunProgress | null;
}) {
  // The stream is authoritative while it is connected; the persisted copy
  // covers the gap before the first frame (and a reload mid-run).
  const steps = progress?.steps.length ? progress.steps : (run.steps ?? []);
  const plan = progress?.plan ?? run.plan ?? null;
  const tokens = progress?.tokens ?? run.tokensUsed;
  const costUsd = progress?.costUsd ?? run.costUsd;
  const now = useNow(true);
  const elapsed = run.startedAt
    ? formatDuration(now - +new Date(run.startedAt))
    : null;

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span
          className="flex items-center gap-2"
          style={{ color: "var(--tandem-agent)" }}
        >
          <AgentSpinner className="size-3" /> Analyzing…
        </span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {elapsed ? `${elapsed} · ` : ""}
          {formatSpend({ costUsd, tokensUsed: tokens })}
        </span>
      </div>

      <PlanBlock plan={plan} degraded={progress?.planDegraded ?? false} />
      <StepList steps={steps} />
    </div>
  );
}

/** The collapsed post-mortem: what the run planned, and how each stage went. */
function RunLog({
  run,
  defaultOpen = false,
}: {
  run: AgentRun;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = run.steps ?? [];
  if (steps.length === 0 && !run.plan) return null;
  return (
    <div className="pt-0.5">
      <button
        type="button"
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-mono text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        run log · {steps.length} steps
      </button>
      {open ? (
        <div className="mt-1 space-y-2">
          <PlanBlock plan={run.plan ?? null} degraded={false} />
          <StepList steps={steps} />
        </div>
      ) : null}
    </div>
  );
}

function PlanBlock({
  plan,
  degraded,
}: {
  plan: string[] | null;
  degraded: boolean;
}) {
  if (!plan || plan.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
        looking for
        {degraded ? (
          <span className="text-yellow-400 normal-case tracking-normal">
            {" "}
            · generic plan (pass 1 failed)
          </span>
        ) : null}
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {plan.map((check) => (
          <li
            key={check}
            className="text-[11px] text-muted-foreground leading-snug flex gap-1.5"
          >
            <span className="opacity-50">·</span>
            <span>{check}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepList({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="space-y-1">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ul>
  );
}

function StepRow({ step }: { step: RunStep }) {
  const running = step.status === "running";
  return (
    <li className="text-[11px] font-mono leading-5">
      <div className="flex items-center gap-1.5">
        {/* Fixed 14px gutter, centred: the three markers are different glyphs
            and one of them spins, so labels must not shift between rows. */}
        <span className="flex-none size-3.5 flex items-center justify-center">
          {running ? (
            <AgentSpinner />
          ) : step.status === "done" ? (
            <span className="text-emerald-400">✓</span>
          ) : (
            <span className="text-destructive">✗</span>
          )}
        </span>
        <span
          className={cn(
            "min-w-0 truncate",
            !running && "text-muted-foreground",
          )}
        >
          {step.label}
        </span>
        <span className="flex-1" />
        {step.detail ? (
          <span
            className={cn(
              "flex-none pl-2 text-[10px] tabular-nums",
              step.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground/80",
            )}
          >
            {step.detail}
          </span>
        ) : null}
      </div>
      {step.paths ? (
        // What it is reading RIGHT NOW — the difference between "something is
        // happening" and "it is reading my code". Indent = gutter + gap.
        <div
          className="pl-5 text-[10px] text-muted-foreground/70 truncate"
          title={step.paths.join("\n")}
        >
          {step.paths.map((path) => path.split("/").pop()).join(" · ")}
        </div>
      ) : null}
    </li>
  );
}

/** Ticking clock for the live elapsed readout; frozen when nothing is running. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function FindingGroup({
  label,
  findings,
  focusedFindingId,
  onSelect,
}: {
  label: string;
  findings: Finding[];
  focusedFindingId: string | null;
  onSelect: (finding: Finding) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <div className="px-3 py-2 border-t border-border/60">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
        {label}
      </div>
      {findings.map((f) => (
        <FindingRow
          key={f.id}
          finding={f}
          focused={f.id === focusedFindingId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FindingRow({
  finding,
  focused,
  onSelect,
}: {
  finding: Finding;
  focused: boolean;
  onSelect: (finding: Finding) => void;
}) {
  return (
    <button
      type="button"
      data-finding-row={finding.id}
      onClick={() => onSelect(finding)}
      className={cn(
        "w-full text-left rounded px-1.5 py-1.5 hover:bg-accent/40",
        focused && "bg-accent/60",
      )}
    >
      <div className="flex items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <span className="text-xs truncate flex-1">{finding.title}</span>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
        {finding.path.split("/").pop()}:{finding.endLine} · {finding.category}
        {finding.suggestion !== undefined ? " · has suggestion" : ""}
      </div>
    </button>
  );
}
