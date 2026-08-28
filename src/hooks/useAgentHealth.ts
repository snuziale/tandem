import { useQuery } from "@tanstack/react-query";
import { fetchAgentHealth } from "../api/runs";

/** Whether the local `claude` CLI exists, and its version. Read by the agent
 * policy page (where a missing CLI makes every switch below it moot) and by
 * About — one query key, so the two pages cost one request between them. */
export function useAgentHealth() {
  return useQuery({
    queryKey: ["agent", "health"],
    queryFn: fetchAgentHealth,
    // Never stale: the server answers this by SPAWNING `claude --version`, a
    // CLI cold start, and the rail unmounts its two readers on every section
    // change. A binary appearing on PATH is a restart-level event, not
    // something to re-probe on each navigation or window focus.
    staleTime: Infinity,
  });
}
