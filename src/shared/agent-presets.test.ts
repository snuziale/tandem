import { describe, expect, test } from "vitest";
import {
  AGENT_PRESETS,
  presetById,
  profileFromPreset,
  promptDefaultsFor,
  promptsFromPreset,
} from "./agent-presets";
import { DEFAULT_PROMPTS, promptTextsOf } from "./prompt-defaults";
import { DEFAULT_AGENT } from "./settings-types";

describe("agent presets", () => {
  test("ids are unique", () => {
    const ids = AGENT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a lens EXTENDS the shared blocks, never replaces them", () => {
    // The anchoring contract, the caps and the score definition live in
    // prompt-defaults; a preset that dropped them would produce findings the
    // pipeline throws away.
    for (const preset of AGENT_PRESETS) {
      const prompts = promptsFromPreset(preset);
      for (const key of ["rules", "orient", "analyze", "chat"] as const)
        expect(prompts[key].startsWith(DEFAULT_PROMPTS[key])).toBe(true);
      expect(prompts.reconcile.startsWith(DEFAULT_PROMPTS.reconcile)).toBe(
        true,
      );
    }
  });

  test("reconcile keeps the cap tokens the pipeline interpolates", () => {
    for (const preset of AGENT_PRESETS) {
      const { reconcile } = promptsFromPreset(preset);
      expect(reconcile).toContain("{findingCap}");
      expect(reconcile).toContain("{nitCap}");
    }
  });

  test("every lens carries its checklist and its guard", () => {
    for (const preset of AGENT_PRESETS) {
      const { rules, orient } = promptsFromPreset(preset);
      expect(preset.checklist.length).toBeGreaterThan(2);
      for (const item of preset.checklist) {
        expect(rules).toContain(item);
        expect(orient).toContain(item);
      }
      expect(rules).toContain(preset.guard);
    }
  });

  test("profileFromPreset copies the text and records the preset", () => {
    const preset = AGENT_PRESETS[0];
    const profile = profileFromPreset(preset, "abc123", DEFAULT_AGENT.models);
    expect(profile.id).toBe("abc123");
    expect(profile.presetId).toBe(preset.id);
    expect(profile.name).toBe(preset.name);
    expect(profile.models).toEqual(DEFAULT_AGENT.models);
    expect(profile.prompts).toEqual(promptsFromPreset(preset));
  });

  test("reset-to-default follows the profile's own lens", () => {
    const preset = AGENT_PRESETS[1];
    expect(promptDefaultsFor(preset.id)).toEqual(promptsFromPreset(preset));
    // No preset, or one removed from a later build: the general defaults.
    expect(promptDefaultsFor(undefined)).toEqual(DEFAULT_PROMPTS);
    expect(promptDefaultsFor("gone")).toEqual(DEFAULT_PROMPTS);
    expect(presetById(undefined)).toBeUndefined();
  });
});

describe("preset profiles round-trip", () => {
  test("a missing block rehydrates from the lens, not the general defaults", () => {
    // sanitizeAgents runs promptTextsOf against promptDefaultsFor(presetId);
    // falling back to DEFAULT_PROMPTS here would render an untouched block as
    // "customized" in Settings, because the field measures against the lens.
    const preset = AGENT_PRESETS[2];
    const filled = promptTextsOf({ rules: "  " }, promptDefaultsFor(preset.id));
    expect(filled).toEqual(promptsFromPreset(preset));
  });
});
