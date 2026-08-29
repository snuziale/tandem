import { describe, expect, it } from "vitest";
import {
  agentEnabledFor,
  DEFAULT_SETTINGS,
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
