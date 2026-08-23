import { Spinner } from "@uipath/apollo-wind";
import App from "../../App";
import { useNativeShortcuts } from "../../hooks/useNativeShortcuts";
import { useConfigStatus } from "../../hooks/useConfigStatus";
import { FirstRunSetup } from "./FirstRunSetup";

export function Bootstrap() {
  useNativeShortcuts();
  const status = useConfigStatus();

  if (status.isPending) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (status.isError || !status.data) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-6">
        <div className="max-w-sm text-sm text-muted-foreground">
          Could not reach the Tandem server at <code>/api/config/status</code>.
          In dev, run <code>pnpm start</code> alongside <code>pnpm dev</code>{" "}
          (or use <code>pnpm dev:all</code>).
        </div>
      </div>
    );
  }

  if (!status.data.configured) {
    return (
      <FirstRunSetup status={status.data} onDone={() => status.refetch()} />
    );
  }

  return <App />;
}
