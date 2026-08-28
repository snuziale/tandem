// About: the read-mostly page — where the data lives, what version is running,
// and the keyboard reference. It answers "what does this app keep about me",
// which nothing else in the UI does.
import { useConfigStatus } from "../../../hooks/useConfigStatus";
import { useAgentHealth } from "../../../hooks/useAgentHealth";
import { useAgentRuns } from "../../../hooks/useAgentRuns";
import { SHORTCUT_GROUPS } from "../../../keyboard/shortcuts";
import { PROXY_USER_AGENT } from "../../../shared/user-agent";
import { Panel, SectionHeading } from "../fields";

/** Everything Tandem writes to disk, in the order it matters. Descriptions
 * rather than sizes: the point is what each file CLAIMS, not how big it got. */
const STORAGE: Array<[file: string, what: string]> = [
  [
    "config.json",
    "GitHub PAT and default org — 0600, never sent to the client",
  ],
  ["settings.json", "everything on these pages except views and teams"],
  ["views.json", "saved queue views"],
  ["teams.json", "named lists of GitHub logins"],
  ["reviews.json", "your pending review drafts, keyed by PR"],
  ["runs.json", "agent runs and their findings, plus spend by day"],
  ["chats.json", "chat transcripts per (PR, sha, finding), 100 most recent"],
  ["seen.json", "last-seen timestamp per PR (the unseen-changes dot)"],
  ["pulse.json", "one row of pulse counts per view per day, 90-day cap"],
  ["claude.log", "stderr from the CLI harness"],
  ["sandbox/", "working directory for the read-only claude passes"],
];

export function AboutSection() {
  const status = useConfigStatus();
  const health = useAgentHealth();
  const runs = useAgentRuns();
  // The server resolves `$TANDEM_HOME` and reports it; this panel asserts
  // that eleven files live there, so it must not re-derive the path.
  const home = status.data?.homePath ?? null;

  return (
    <>
      <SectionHeading title="About">
        A GitHub review center with an inline agent. It proposes; you submit.
      </SectionHeading>

      <Panel title="Versions">
        <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-1.5 text-xs max-w-2xl">
          <dt className="text-muted-foreground">Tandem</dt>
          {/* The User-Agent is where the version already lives, so it stays
              the single source rather than a second constant to forget. */}
          <dd className="font-mono">
            {PROXY_USER_AGENT.replace("tandem/", "")}
          </dd>
          <dt className="text-muted-foreground">Claude CLI</dt>
          <dd className="font-mono">
            {health.data?.available
              ? (health.data.version ?? "available")
              : health.data
                ? "not found on PATH"
                : "…"}
          </dd>
          <dt className="text-muted-foreground">Agent spend today</dt>
          <dd className="font-mono">
            ${runs.data?.spendTodayUsd.toFixed(2) ?? "0.00"}
          </dd>
        </dl>
      </Panel>

      <Panel
        title="Storage"
        hint={
          home ? (
            <>
              Everything is local, under{" "}
              <code className="font-mono text-[11px]">{home}</code>, written
              atomically at 0600. Nothing is uploaded anywhere.
            </>
          ) : (
            "Everything is local, written atomically at 0600."
          )
        }
      >
        <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-y-1 text-xs max-w-3xl">
          {STORAGE.map(([file, what]) => (
            <div key={file} className="contents">
              <dt className="font-mono text-muted-foreground">{file}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel
        title="Keyboard"
        hint="The same reference the ? sheet shows, without having to leave the
        page to read it."
      >
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <h3 className="text-xs font-semibold">{group.title}</h3>
              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-[11px]">
                {group.items.map(([keys, action]) => (
                  <div key={keys} className="contents">
                    <dt className="font-mono text-muted-foreground">{keys}</dt>
                    <dd className="text-muted-foreground">{action}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
