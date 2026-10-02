import { describe, expect, it } from "vitest";
import {
  agentEnabledFor,
  DEFAULT_AGENT,
  DEFAULT_SETTINGS,
  effectiveContext,
  type TandemSettings,
} from "./settings-types";

function settings(over: Partial<TandemSettings> = {}): TandemSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

describe("agentEnabledFor", () => {
  it("prefers the per-repo toggle over the global default", () => {
    const s = settings({
      agentEnabledByDefault: true,
      repos: { "o/r": { agentEnabled: false } },
    });
    expect(agentEnabledFor(s, "o/r")).toBe(false);
    expect(agentEnabledFor(s, "o/other")).toBe(true);
  });

  it("falls back to the global default for an unconfigured repo", () => {
    expect(
      agentEnabledFor(settings({ agentEnabledByDefault: false }), "o/r"),
    ).toBe(false);
    expect(
      agentEnabledFor(settings({ agentEnabledByDefault: true }), "o/r"),
    ).toBe(true);
  });

  it("lets a repo opt IN against a global default of off", () => {
    const s = settings({
      agentEnabledByDefault: false,
      repos: { "o/r": { agentEnabled: true } },
    });
    expect(agentEnabledFor(s, "o/r")).toBe(true);
  });
});

describe("effectiveContext", () => {
  const repoAgent = { ...DEFAULT_AGENT, context: "repo" as const };

  it("uses the local clone when one is configured for the repo", () => {
    const s = settings({ repoPaths: { "o/r": "~/code/r" } });
    expect(effectiveContext(s, repoAgent, "o/r")).toEqual({
      depth: "repo",
      localPath: "~/code/r",
    });
  });

  it("degrades a repo profile one step, to whole files, and says why", () => {
    expect(effectiveContext(settings(), repoAgent, "o/r")).toEqual({
      depth: "files",
      degraded: "no-local-path",
    });
  });

  it("never reaches for a clone on a profile that did not ask", () => {
    const s = settings({ repoPaths: { "o/r": "~/code/r" } });
    expect(
      effectiveContext(s, { ...DEFAULT_AGENT, context: "diff" }, "o/r"),
    ).toEqual({ depth: "diff" });
  });
});
