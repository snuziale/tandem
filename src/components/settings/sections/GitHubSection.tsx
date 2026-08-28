// Connection › GitHub: the personal access token every read and both writes
// go through. Nothing else lives here — the claude CLI's status sits on the
// Review policy page, next to the switches it decides the fate of.
import { useConfigStatus } from "../../../hooks/useConfigStatus";
import { CredentialsForm } from "../../setup/CredentialsForm";
import { Panel, SectionHeading } from "../fields";

export function GitHubSection() {
  const status = useConfigStatus();

  return (
    <>
      <SectionHeading title="GitHub">
        The personal access token every queue search, diff and review goes
        through. Reviews post as this account — Tandem never authors as anyone
        else.
      </SectionHeading>

      <Panel
        title="Credentials"
        hint={
          status.data ? (
            <>
              Stored at{" "}
              <code className="font-mono text-[11px]">
                {status.data.configPath}
              </code>{" "}
              with 0600 permissions, server-side only — the browser never sees
              the token.
            </>
          ) : null
        }
        aside={
          status.data?.login ? (
            <span className="text-xs font-mono text-muted-foreground">
              reviews post as{" "}
              <span className="text-foreground">@{status.data.login}</span>
            </span>
          ) : null
        }
      >
        {status.data ? (
          <div className="max-w-2xl">
            <CredentialsForm
              fields={status.data.fields}
              initialValues={status.data.currentValues}
              submitLabel="Save credentials"
              mode="update"
              size="xs"
              onSaved={() => status.refetch()}
            />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
