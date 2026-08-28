// Starter agent profiles — a LENS, not a second prompt system.
//
// A profile's five prompt blocks are the widest thing a user can edit, and
// writing four of them from a blank box is how "specialized agents" stayed a
// feature nobody used. A preset answers that with the smallest possible unit:
// one focus sentence and one checklist, injected into the SHARED defaults
// rather than replacing them. So the review rules, the JSON anchoring
// contract, the caps and the score definition are still written once in
// prompt-defaults.ts — a preset can only say what to look AT, never what the
// output must be. (The output contract is code-owned regardless; parse.ts
// re-enforces it whatever a prompt says.)
//
// Presets are TEMPLATES: `profileFromPreset` copies the text into
// settings.json at the moment the profile is created, so editing a block is
// editing that profile and an upgrade never rewrites prompts a user tuned.
// `presetId` rides along only so a field's "reset to default" returns to the
// preset it came from instead of the general reviewer's text.
import { DEFAULT_PROMPTS, type PromptTexts } from "./prompt-defaults";
import type { AgentProfile } from "./settings-types";

export type AgentPreset = {
  id: string;
  name: string;
  description: string;
  /** One sentence: what this reviewer is looking at, in its own voice. */
  focus: string;
  /** What to hunt, as the model sees it. Steers pass 1's plan and pass 2's
   * search; deliberately concrete, because "check the architecture" produces
   * a finding about nothing. */
  checklist: string[];
  /** The one rule that keeps this lens from generating noise. Every lens has
   * a characteristic failure mode — the architecture reviewer proposing a
   * rewrite, the performance reviewer flagging a 10-item loop — and naming it
   * is worth more than another checklist item. */
  guard: string;
};

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "correctness",
    name: "Correctness",
    description:
      "Does the code do what it claims, under the inputs it will actually see?",
    focus:
      "You are reviewing for BEHAVIOR: whether this code is correct under the inputs, orderings and failures it will really meet — not whether it is pretty.",
    checklist: [
      "Edge cases the happy path skips: empty collections, zero, one element, the last element, null/undefined, a missing optional field.",
      "Boundaries and off-by-ones: slice/substring ends, loop bounds, inclusive-vs-exclusive ranges, index arithmetic.",
      "Async ordering: awaits that let state change underneath, unhandled rejections, races between two callers, work that continues after cancellation or unmount.",
      "Error paths: a catch that swallows, an error rethrown with the cause lost, a fallback that hides a real failure, a partial write left behind.",
      "Contract drift: a changed function whose other callers were not updated, a widened return type nobody handles, a nullable that became non-null in one place only.",
      "Data trusted too early: model, network or user input used before validation; a parse that can throw where nothing catches.",
    ],
    guard:
      "A different-but-equivalent way to write the same thing is NOT a finding. Every finding needs a concrete input or ordering that makes the code do the wrong thing — if you cannot name one, drop it.",
  },
  {
    id: "architecture",
    name: "Architecture",
    description:
      "Does the change fit the system it lands in — boundaries, ownership, coupling?",
    focus:
      "You are reviewing SEAMS: where this change puts responsibility, what it couples to what, and whether the system stays explainable after it merges.",
    checklist: [
      "A second source of truth: state, config or a rule now derivable from — or duplicated against — something that already exists.",
      "A layer reached across: UI touching storage directly, shared/runtime-neutral code importing a runtime-specific module, a server concern leaking into a component.",
      "A new abstraction with one caller, or a wrapper that only renames what it wraps — versus an existing mechanism that should have been extended instead.",
      "State placed away from its consumers, or lifted higher than anything that reads it.",
      "Exported surface widened without a consumer: a helper made public, an internal type re-exported, an option nothing passes.",
      "Dependency direction and cycles: a module importing something that should depend on IT.",
      "Persisted or wire shapes changed without a migration or a tolerant reader.",
    ],
    guard:
      "Scope every finding to what THIS diff introduces or makes worse. Never propose a rewrite of code the PR merely touched, and never say 'consider refactoring' — name the specific alternative placement and what it buys.",
  },
  {
    id: "react",
    name: "React",
    description:
      "Render purity, effects, state ownership, identity and hook rules.",
    focus:
      "You are reviewing the COMPONENT MODEL: what renders, what re-renders, what React owns and what the code is doing behind its back.",
    checklist: [
      "State that is derived: a value computed from props or other state and stored in state, then kept in sync by an effect.",
      "Effects doing non-effect work: an effect that only sets state, one that belongs in an event handler, one that runs on every render because its deps are unstable.",
      "Stale closures and wrong dependency arrays — including deps quietly omitted to stop a loop.",
      "Cleanup: subscriptions, timers, observers, listeners and in-flight requests not torn down; state set after unmount.",
      "Identity: inline objects, arrays and callbacks handed to memoized children, hook deps, or context values recreated every render.",
      "Keys: an index key on a reorderable list, or a key that is not stable across renders.",
      "Purity: mutation of props, refs or module state during render; reading layout in render; conditional or looped hook calls.",
      "Controlled/uncontrolled flips, and focus not managed when a dialog, menu or composer opens and closes.",
    ],
    guard:
      "Do not report memoization as a finding on its own — `useMemo`/`useCallback` that changes nothing measurable is noise. Report identity only where it breaks a memo boundary, a dep array, or an effect's run count.",
  },
  {
    id: "performance",
    name: "Performance",
    description: "Work per call and per render, and how it scales with N.",
    focus:
      "You are reviewing COST: the work this code does per call, per render and per item, and what happens to it as the data grows.",
    checklist: [
      "Accidental quadratic work: a find/includes/filter inside a loop over the same data, a nested scan that could be one map or set.",
      "Repeated work: a computation, parse, regex compile or allocation inside a loop or a render that could be hoisted or done once.",
      "Sequential awaits that are independent and could run together, and N+1 request patterns — one call per item where one call could carry all of them.",
      "Unbounded growth: a query with no cap or pagination, a cache with no eviction, an array or map that only ever grows.",
      "Main-thread blocking: a large synchronous parse or serialize, a regex that can backtrack, work that belongs behind a boundary the user does not wait on.",
      "Re-render storms: a store or context selector returning a fresh object, a provider value that changes every render, a long list rendered whole.",
      "Payload: fields fetched and never read, or a response that grows with history where a fixed-size one would answer the same question.",
    ],
    guard:
      "Every finding must name the scale at which it hurts — the N, the frequency, or the payload size. A micro-optimization over ten items is not a finding, and a claim of slowness with no magnitude behind it is a guess.",
  },
];

export function presetById(id: string | undefined): AgentPreset | undefined {
  return id ? AGENT_PRESETS.find((p) => p.id === id) : undefined;
}

/** The preset's five blocks: the shared defaults with the lens folded in.
 * `rules` and `orient` carry the checklist (they are what steer the search);
 * the later passes get the focus line, because by then the plan already
 * names the specifics. */
export function promptsFromPreset(preset: AgentPreset): PromptTexts {
  const d = DEFAULT_PROMPTS;
  const checklist = preset.checklist.map((item) => `- ${item}`).join("\n");
  const lens = `Lens — ${preset.name}. ${preset.focus}`;
  return {
    rules: `${d.rules}

${lens}

Look for:
${checklist}

${preset.guard}`,
    orient: `${d.orient}

${lens} Build the plan out of THIS PR's diff under that lens — pick the items below that the changed files actually expose, and skip the rest rather than padding to six.

${checklist}`,
    analyze: `${d.analyze}

${lens} Findings outside this lens belong to another profile: mention them in nothing, and spend the pass on what you were asked to look at.`,
    reconcile: `${d.reconcile}

${lens} Rank under it: a finding squarely inside this lens outranks a stronger-sounding one outside it, and the summary should read as this reviewer's, not a general one's.`,
    chat: `${d.chat}

${lens} Stay in it when you answer — if the reviewer asks something outside it, answer briefly and say which lens would cover it properly.`,
  };
}

/** A profile built from a preset, ready to drop into `settings.agents`.
 * Models come from the general reviewer: a lens changes what to look at, not
 * what it costs — the user picks a bigger model per profile if they want one. */
export function profileFromPreset(
  preset: AgentPreset,
  id: string,
  models: AgentProfile["models"],
): AgentProfile {
  return {
    id,
    name: preset.name,
    description: preset.description,
    presetId: preset.id,
    models,
    prompts: promptsFromPreset(preset),
  };
}

/** What a field's "reset to default" returns to: the profile's own preset
 * text when it came from one, the general defaults otherwise. */
export function promptDefaultsFor(presetId: string | undefined): PromptTexts {
  const preset = presetById(presetId);
  return preset ? promptsFromPreset(preset) : DEFAULT_PROMPTS;
}
