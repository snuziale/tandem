# Tandem

A GitHub review center with an inline agent: the agent pre-reads every PR in your queue and drafts
review comments into your **local pending review**; you triage them, add your own, and submit ONE
GitHub review as yourself. Built on the skeleton of Sift, a private predecessor project (comments
citing "Sift" point at patterns carried over from it) — Bun + webview-bun native app, Vite/React 19
SPA, Apollo Wind, TanStack Query, Zustand.

> Collaboration norms (response style, ask-vs-execute, commit cadence): [`AGENTS.md`](./AGENTS.md).
> This file documents the codebase.

## Three invariants (from the spec — do not erode)

1. **The agent never writes to GitHub.** `server/github/submit.ts` is the ONLY module that mutates
   GitHub, and it exposes exactly two operations: submit-review and quick-approve, both
   human-triggered. The claude CLI runs with `--safe-mode --tools ''` — no write tools exist.
   **One sanctioned exception, explicitly opt-in**: `settings.autoApprove` (default OFF) lets
   `maybeAutoApprove` in `pipeline/run.ts` post an empty APPROVE when EVERY gate holds — pass-3
   score ≥ threshold, zero undismissed blocker/risk findings, checks green (unless waived), not a
   draft, and no human draft in progress. Never widen those gates silently.
2. **Pre-warming hides latency — but automatic runs are OPT-IN** (user decision 2026-08-21,
   overriding the spec's default). `settings.autoRunEnabled` is false by default: the queue sweep
   only does maintenance (staleness marking, draft re-anchoring); model runs start from the rerun
   button / `r`. When the user flips it on, every queue poll feeds `server/agent/prewarm.ts`,
   cached by `(prId, headSha)`.
3. **Violet = machine-authored, nowhere else.** `--tandem-agent*` tokens in `src/index.css`. Queue
   agent cell, file-tree dots, finding rails/labels, agent rows in the tray. Never reuse it.

## Running / verifying

```bash
pnpm dev:all        # Bun server + Vite (or `pnpm start` + `pnpm dev` in two terminals)
pnpm test           # pure logic: normalizers, queue query, patch index, parse/caps, decide, routes
pnpm typecheck      # gen manifest + tsc -b (3 projects: app / node / server)
pnpm lint
pnpm build:app      # macOS .app via bun build --compile (scripts/build-app.ts)
TANDEM_HOME=/tmp/x pnpm start   # scratch home — don't pollute ~/.tandem while testing
```

Dev needs BOTH processes: the Vite proxy forwards ALL `/api/*` to the Bun server (first free port
from 5274, `$TANDEM_SERVER_PORT`). There is no env-driven auth in the Vite config — credentials
live server-side only. `GITHUB_TOKEN` env seeds `~/.tandem/config.json` on first run.

## How requests flow

```
browser → /api/* → Vite proxy (dev) → Bun server (src/server/worker.ts)
  /api/config/*    config/routes.ts      PAT store, /user probe (login), test/save
  /api/queue       github/queue.ts       one GraphQL search PER VIEW, parallel (see below)
  /api/prs/:o/:r/:n[...]  github/routes.ts  detail (GraphQL) · files (REST+fallback) ·
                                            approve · submit  ← the only two GitHub writes
  /api/reviews/:prId  reviews/routes.ts  local pending-review draft (GET/PUT/DELETE)
  /api/views       views/routes.ts       saved queue views (created/edited/imported from the
                                         queue UI; the views-JSON dialog round-trips the exact
                                         views.json array — utils/viewsJson.ts validates imports)
  /api/seen        seen/routes.ts        last-seen per PR (detail marks; queue shows the
                                         unseen-changes dot when updatedAt moved past it)
  /api/settings    settings/routes.ts    caps, threshold, models, per-repo agent toggle,
                                         prompts (see below)
  /api/runs[...]   agent/routes.ts       run records · SSE stream · cancel · finding state
  /api/chats[...]  agent/chat/routes.ts  chat turns · SSE token stream · cancel · apply/reject
                                         one proposed action (the only state-changing chat call)
  /api/agent/health                      claude CLI availability
  /*               assets.ts             SPA (embedded via asset-manifest in the binary)
```

**Queue divergence from the spec**: views are NOT batched into one aliased GraphQL request. A
batch's execution time is the sum of its searches and GitHub kills GraphQL around ~10s (502); an
org-wide view alone runs ~9s. One request per view, in parallel — same rate-limit points, per-view
errors, and a single 502-retry in `github/client.ts`.

## The agent pipeline (server/agent/)

`pipeline/run.ts` orchestrates three passes per `(prId, headSha)`, each a read-only headless
`claude -p` one-shot (`claude.ts`; prompt over stdin, result frame parsed for text + usage):

1. **Orient** (haiku): PR meta + file list + `.tandem/conventions.md` + recent commits → a 3–6 item
   review plan. A failed orient degrades to a generic plan, never fails the run.
2. **Analyze** (sonnet): per file cluster (`cluster.ts`: top-dir grouping, ≤8 files/≤800 lines) →
   candidate findings as strict JSON.
3. **Reconcile** (sonnet): candidates + existing human threads → deduped, ranked, capped final set
   + run summary. This pass keeps output signal-dense; do not skip it.

**Agents are configurable profiles** (`settings.agents: AgentProfile[]` + `defaultAgentId`): each
profile carries its own per-pass models and prompt instruction blocks, so agents can specialize
(security sweep, test-coverage, …). Runs record `agentId`/`agentName`; the pane's rerun menu can
run any profile; prewarm/plain reruns use the default. Legacy top-level `models`/`prompts`
migrate into the default profile on load (settings/store.ts sanitizeAgents). Defaults live in
`shared/prompt-defaults.ts` (per-field reset in Settings); `{findingCap}`/`{nitCap}` interpolate
in reconcile. A profile carries a fourth model + prompt for the chat pass (see below). The data blocks and JSON output contracts in `pipeline/prompts.ts` stay code-owned —
they must match the zod schemas, and parse.ts re-enforces the rules regardless of prompt edits.
Pass 3 also emits a 0-100 merge-readiness `score` (stored on the run, shown in queue + pane) —
the auto-approve gate reads it.

Model output is untrusted (`pipeline/parse.ts`): last-JSON extraction → zod (`shared/
finding-schema.ts`) → ONE repair attempt → visible failure. Then deterministic re-enforcement:
findings must anchor to real diff lines (`diffLineIndex` in `shared/gh/patch.ts`), human-thread
duplicates drop, severity×confidence ranking under the caps (default 8 findings, 3 nits).

- **Runs are server-owned** (`live.ts`): closing the pane detaches; `POST /api/runs/:id/cancel` is
  the only kill switch. SSE = replay-then-tail in one synchronous block.
- **Progress is structural, and it is PERSISTED** (`RunStep` in `shared/agent-types.ts`, recorded by
  `stepRecorder` in `pipeline/run.ts`): one step per stage — fetch, orient, one per pass-2 cluster
  (carrying that cluster's `paths`), reconcile — each emitted for the live pane AND written onto
  `run.steps`, plus `run.plan` (pass 1's checks). The live replay buffer dies with the run, so the
  persisted copy is what makes a reload mid-run and the pane's collapsed "run log" read the same;
  a failed run names the step that died instead of just carrying a message. `useRunStream`
  ACCUMULATES these frames (keyed by runId, never reset from an effect) — it does not keep only the
  latest. Do NOT stream tokens for the pipeline passes: each answers with one strict-JSON blob, so
  `--include-partial-messages` stays chat-only and everything watchable is derived from the steps.
- **Cache rule**: never re-run a sha without explicit rerun. Failed runs stay manual — auto-retry
  would burn budget every poll.
- **Prewarm** (`prewarm.ts`): gated on `settings.autoRunEnabled` (default OFF — runs are manual).
  When on: cheap skips (pure `pipeline/decide.ts` — draft/caps/budget/disabled) are recorded as
  Skipped runs without invoking the model; real work queues behind a 2-run cap. When off, the
  sweep still does staleness marking + draft re-anchoring — that's maintenance, not a run.
- **Staleness** (spec §2): new headSha → old run + findings `stale` (kept visible, never deleted),
  draft comments re-anchored (`anchorMoved` flags what no longer lands; draft sha advances), new
  sha auto-enqueued. State machines are edge tables in `shared/agent-types.ts`, enforced in
  `runsIndex.ts` — illegal transitions throw.
- Spend: per-run cost lands in `runs.json` `spendByDay`; `decide.ts` stops runs at the daily
  ceiling. Subscription-billed CLI reports $0 — UI falls back to token counts.

## Chat — the fourth pass (server/agent/chat/)

Ask the agent about the PR, or about ONE finding: why it flagged something, whether it still
believes it, how to reword the comment. Interactive, but the same read-only pass as the pipeline
(`--safe-mode --tools ''`), and it changes nothing on its own.

- **Scope is the identity.** `chatKeyOf(prId, headSha[, findingId])` is the session id, the storage
  key, and the URL segment — so opening a finding's thread is a plain GET with no create call, and
  a new head sha is a new conversation. The pane's focused finding IS the scope (`ChatPanel` is
  mounted keyed by it).
- **Stateless multi-turn, not CLI session resume.** Each turn rebuilds
  `[immutable context] + [transcript] + [question]` (`chat/prompt.ts`) — stable prefix first, so
  prompt caching pays for the diff instead of us re-paying per message. Transcripts live in
  `chats.json`; `--no-session-persistence` stays.
- **Prose first, actions in an OPTIONAL trailing ```json fence** (`chat/prose.ts`): strict JSON is
  not the product here, so an unparseable tail degrades to prose-only instead of failing the turn.
  `createFenceGate` hides the fence while it streams (only ```json — a ```ts snippet still
  streams); `splitTrailingJson` walks fences line by line and is authoritative for what persists.
- **Actions are PROPOSALS, gated twice** (`chat/actions.ts`): `sanitizeChatActions` before the chip
  is shown (ids exist, transitions legal, `new-finding` anchored via `diffLineIndex` and dropped
  where a human already commented — the pass-2 gate), then re-validated on click, because the
  finding may have been staged or dismissed since. Kinds: revise-finding (proposed/edited only —
  a STAGED finding's text belongs to the draft, so that's `revise-comment` on its localId),
  dismiss-finding, new-finding, revise-comment. Apply is human-triggered only; invariant §1 holds.
- **`needContext` is a SERVER hop, not a tool.** The turn may ask for files it cannot see; the
  server fetches them read-only at the PR's head sha (`chat/context.ts`, ≤2 hops, owner/repo from
  the session, never from the model) and re-asks. No write tool exists at any point.
- Turns are server-owned (`live.ts`, `kind: "chat"` so they stay out of the run accounting) and
  stream real token deltas (`--include-partial-messages`, chat only). Chat spends from the SAME
  daily ceiling as runs.

## The review flow (the human half)

- The draft (`PendingReview`) lives SERVER-SIDE in `~/.tandem/reviews.json`, keyed by prId —
  browser and native app agree; optimistic updates via `usePendingReview`.
- Line click → composer annotation → staged `PendingComment` (optionally with an exact-replacement
  `suggestion`). Accepting a finding stages `**title**\n\nbody` + suggestion with `findingId` set —
  that drives the tray's human/agent breakdown and finding-state transitions. Removing an
  agent-staged comment returns the finding to `proposed`.
- **Submit posts the server-side draft**, not a client payload: `POST …/submit {verdict, summary}`
  → suggestion fences composed, `commit_id` = draft sha, per-comment 422s surfaced, drafts with
  `anchorMoved` comments refused (409). Success clears the draft.
- Blocker gate (guard rail, not a block): quick-approve disabled + `a` refused while an undismissed
  blocker exists; `shift+A` overrides; APPROVE submit blocked the same way.

## Diff pane — @pierre/diffs notes

One controlled `CodeView` hosts every file (`components/pr/DiffPane.tsx`):

- Items: `{id: path, type:'diff', fileDiff, annotations, version}`. `fileDiff` =
  `parsePatchFiles(buildFilePatch(file))` — REST `patch` is bare hunks; `buildFilePatch`
  (`shared/gh/patch.ts`) re-adds git headers. Memoize; keep object identity stable.
- Controlled items re-render ONLY on `version` change. Annotation CONTENT flows through React
  (render prop); `version` is a pure hash of headSha + annotation POSITIONS + the item's
  `collapsed` flag (`versionOf`). Don't replace it with a render-time counter — the React Compiler
  lint forbids ref/module mutation in render (learned the hard way).
- Everything inline is a `DiffLineAnnotation<TandemAnno>`: human thread (blue rail), staged comment,
  composer, agent finding (violet rail). Side mapping LEFT→`deletions`, RIGHT→`additions`
  (`components/pr/annotations.ts`).
- **The file header is ours** (`renderCustomHeader` → `components/pr/DiffFileHeader.tsx`): the
  library's default header can't do what we need. The path is a BUTTON that syncs the file tree
  (`onSelectPath` → `selectedPath`, no diff re-scroll), a chevron folds that one file, and
  **viewed is a CHECKBOX per file, there** — the pane toolbar keeps only the `viewed n/m` tally.
  Header slots are light DOM (`slot="header-*"`), so Tailwind reaches them and content re-renders
  through React WITHOUT a `version` bump — verified for the viewed toggle.
- **Folding is derived state, owned by `PrDetailView`** (`foldOverrides` + `collapsedPaths`): a
  viewed file is folded (that's what marking viewed means), the chevron writes a per-path
  override, and toggling viewed DROPS that override so the checkbox folds and unfolds again.
  Selecting a file in the tree or focusing a finding force-expands — a `scrollTo` into a folded
  file lands on its header.
- **`options.itemMetrics.diffHeaderHeight` MUST match our header's real height** (36px = `h-9`).
  The library reserves 44 by default, so every item's layout height silently ran 8px ahead of what
  it renders; when the layout total exceeds the real content, CodeView centres its render window in
  the slack — with all files folded that showed up as ~90px of blank space above the first row.
  Re-check this if `DiffFileHeader`'s height ever changes.
- The CodeView container MUST be the overflow parent (`overflow-y-auto` + bounded height) or
  nothing scrolls and `scrollTo` no-ops silently.
- `scrollToTwice` (PrDetailView) keeps ONE pending follow-up scroll: holding `]` steps files faster
  than the 350ms re-scroll lands, and stale timers yank the pane back to files already left.
- `scrollTo` against virtualized estimates lands short — scroll twice (immediately + ~350ms).
- Split/unified via `options.diffStyle`; theming via `options.theme {dark, light}` +
  `options.themeType` (shadow DOM — Tailwind classes don't reach inside).

The FILE TREE is `@pierre/trees` (`components/pr/FileTree.tsx`): `useFileTree` constructs the
model ONCE — later state reaches rows through model methods, so `renderRowDecoration` reads a
ref (`stateRef`) and a `setGitStatus(freshArray)` call after viewed/agent changes re-renders the
visible rows. Git-status badges come from the PR's change types; decorations carry `+a −d`,
viewed ✓, and the violet agent dot. External selection follows the `selectedPath` prop
(select + scrollToPath) — and selection is SINGLE: `item.select()` is additive, so both the
external-selection effect and `onSelectionChange` deselect everything else. One file is open in
the diff, so more than one highlighted row is a lie. The tree owns its keyboard (arrows, a-z type-ahead, search) — the detail
key handler bails when the event target is inside `[data-tandem-filetree]`.

Its shadow-DOM palette is OUR tokens, set as `--trees-theme-*` on the host (custom properties
inherit through the shadow boundary). Do NOT go back to `themeToTreeStyles(shikiTheme)`: it paints
GitHub's sidebar surface, which is near the app's but not it, and it resolves asynchronously — the
first paint fell back to the library's light defaults and flashed white in dark mode.

## Layout

```
src/
  shared/              client↔server bridge (tsconfig.server compiles ONLY server+shared)
    api-paths.ts  config-types.ts  github-credentials.ts  review-types.ts  agent-types.ts
    finding-schema.ts (zod)  settings-types.ts  is-plain-object  runtime  user-agent
                     kebab-case here; gh/ below is a camelCase sub-package. `-schema` means
                     zod (chat-schema, finding-schema); plain data is named for what it holds.
    gh/              runtime-neutral GitHub core, ALL TESTED: wire.ts (raw shapes),
                     normalize.ts, queueQuery.ts, detailQuery.ts, patch.ts (buildFilePatch,
                     splitRawDiff, diffLineIndex), generated.ts, prKey.ts (prId = "owner/repo#n")
  server/            Bun-only
    worker.ts (flat prefix router, port scan 5274-81, idleTimeout 0)  app.ts (webview host)
    runtime.ts  assets.ts (+generated asset-manifest.ts)  log  pathMatch  requestJson
    storage/jsonFile.ts   atomic temp+rename, 0600, PER-PATH mutation queue — the only
                          JSON persistence path; don't hand-roll another
    config/  github/{client,queue,pr,files,submit,routes}  reviews/  views/  settings/
    agent/   claude.ts (CLI harness)  procStream  live.ts (runs + chat)  sse.ts (replay-then-
             tail, shared)  runsIndex.ts  prewarm.ts  routes.ts
             pipeline/{run,prompts,cluster,parse,context,decide}
             chat/{turn,prompt,prose,actions,context,store,routes}
  api/               plain-fetch clients (http.ts wrapper + one file per resource, named for
                     the resource: config, settings, queue, prs, reviews, runs, seen, views)
  hooks/             useQueue (60s poll + focus refetch)  usePrDetail/usePrFiles (files:
                     staleTime Infinity per sha)  usePendingReview (optimistic)  useAgentRuns
                     (30s poll, byKey index)  useRunStream (SSE)  useChat (transcript + turn
                     stream + apply)  useSettings
                     useSavedViews (+ useViewActions: every view write + its navigation)
                     useActiveView (URL ↔ view list reconciliation)
                     useKeyboardNav (global dispatcher) — `use*` ONLY; the plain-function
                     half lives in actions/ (below)
  actions/           chat.ts  finding.ts  queue.ts — triage/nav actions as plain functions
                     over the queryClient + stores, callable from components AND from the
                     keyboard dispatchers, which run outside React
  state/             themeStore (persist)  uiStore (route, focus, composer target, lastViewId,
                     lastFacet, statsOpen; persist partialize: diffStyle + lastViewId + pane/stats toggles)
  keyboard/          keyOwnership.ts (isTypingTarget/hasOpenDialog)  shortcuts.ts (? sheet registry —
                     manually synced with the dispatchers)
  routes.ts          History-API routing: /?view=<id>[&by=<dim>:<value>] ·
                     /:owner/:repo/pull/:n · /settings
                     (navigateToQueue() = back to the last-selected view AND facet)
  utils/queueStats.ts  TESTED pure stats + facets over the active view's rows
                     (buckets, top-N folding, parse/format/match facet)
  components/        layout/AppHeader (the ONE header: chrome + brand + agent pill + settings
                     + theme; screens fill `children`/`actions`) queue/ pr/ agent/
                     review(tray in pr/)/ settings/ setup/  common/ (Markdown, ErrorBoundary,
                     ShortcutsHelp) — every component lives in a subdirectory, none at the root
```

## Storage (`$TANDEM_HOME ?? ~/.tandem`, all via jsonFile.ts, all 0600)

```
config.json    PAT (+defaultOrg)          settings.json  caps/threshold/models/repos
views.json     saved queue views          reviews.json   pending-review drafts by prId
runs.json      AgentRun by prId@headSha + spendByDay     claude.log  harness stderr
chats.json     ChatSession by prId@headSha[#findingId], LRU-capped at 100
seen.json      last-seen updatedAt per prId (drives the unseen-changes dot)
sandbox/       cwd for the read-only claude passes
localStorage   tandem:theme:v1 · tandem:ui:v1 (diffStyle, lastViewId, pane + stats toggles) —
               display prefs ONLY
```

## Keyboard

Two dispatchers, one guard module (`keyboard/keyOwnership.ts`), one display registry
(`keyboard/shortcuts.ts` — update it when touching either dispatcher):

- `useKeyboardNav` (mounted in App): `?` everywhere; queue keys
  j/k/Enter/o/a/A(override)/r/s/esc//. Reads state via `getState()` snapshots — the listener
  never re-binds.
- `PrDetailView` binds its own detail keys (esc, [ ], j/k findings, y/e/x, c chat, v, r, a, o) — same
  snapshot pattern via a ref updated in an effect. Composer/tray own ⌘↵ (stage vs submit) — the
  tray's is a WINDOW listener that bails on `isTypingTarget`, which is why a text box can claim
  ⌘↵ for itself. The chat composer is the one box that sends on plain ↵ (⇧↵ = newline, ⌘↵ still
  works): it is a chat box, and overloading ⌘↵ a third time reads as ambiguous.

## Queue stats drawer (`components/queue/StatsDrawer.tsx` + `charts.tsx`)

A breakdown of the ACTIVE VIEW, toggled from the header (`s`), where every mark is also a
filter. Snapshot only — the queue payload is the currently-open PRs, so these are
distributions, never trends. Real trends would need a queue journal on disk; that's a
separate feature, not a tweak to this one.

**It describes the PAGE, not the view.** The queue fetches ONE page (`first: 50`) while the
tab badge shows GitHub's `issueCount` — so a 521-match view yields 50 rows. The table has
always been a top-50 list and that's fine; a *breakdown* is not, because it reads as a claim
about the whole view. `StatsDrawer` takes `matching` (the view's issueCount) and, when it
exceeds the loaded rows, says so above the charts. Never drop that caveat.

- **All logic is pure and tested** (`utils/queueStats.ts`): idle/size/checks/review bucketing,
  top-6 nominal folding, and facet parse/format/match. The components only lay it out.
- **The facet is URL state** (`?by=author:alice`) for the same reasons the view is. A facet
  implies an OPEN drawer (`QueueView.statsShown`) — closing the drawer or hitting `s` clears
  it, `esc` clears the facet alone. Switching views drops it (`useViewActions.select`), but a
  round trip into a PR does NOT: `uiStore.setRoute` mirrors every queue route's facet into
  `lastFacet` (the one funnel navigate/popstate/initial-resolve all pass through) and
  `navigateToQueue()` restores it, so "← Queue" and the detail screen's `esc` land back on the
  filtered queue. Session-only, unlike `lastViewId` — a cold launch starts unfiltered.
- **Charts read the UNFILTERED rows; only the table narrows.** A chart that collapsed onto its
  own selection couldn't be used to pick the next slice. `QueueView` passes `allRows` to the
  drawer and `filterByFacet(...)` to the table.
- **Color is by JOB, not by taste.** Nominal dimensions (author, repo) are ONE series → one
  flat `--tandem-bar`; ordered ones (idle, size) take the 4-step single-hue `--tandem-ramp-*`
  ramp; checks/review wear the design system's reserved STATUS tokens and always ship a
  written label + count. Selection is EMPHASIS (others drop to 40%), never a recolor — a hue
  must never come to mean "selected". Both ramps are validated (monotone L, adjacent ΔL ≥
  0.06, light-end ≥ 2:1 on their own surface); re-validate if the hexes in `index.css` change.
- **Bar length scale differs by kind**: ordinal bars scale to the view total (their buckets
  partition it), nominal top-N bars to their own largest slice, or six authors out of fifty
  render as six empty tracks. A zero value gets NO mark; non-zero is floored at 3px.
- Every value is printed as text beside its mark, so the charts are their own table view and
  nothing is hover-gated.
- The queue rows carry the same idea inline: the size cell's churn bar shares ONE scale (the
  largest churn on screen, computed in `QueueTable`), and the agent cell's score meter is
  violet because the score is machine-authored — it and its number never wrap apart.

## Design decisions (settled — surface a tradeoff before changing)

- **Typed server endpoints, not a GitHub passthrough proxy**: prewarm/pipeline need server-side
  normalized access, and "exactly two writes" stays auditable.
- **Parallel per-view queue searches** (spec divergence, documented above).
- **The selected queue view is URL state** (`/?view=<id>`), never component state: tab switches
  are history entries, a view is linkable, and back-from-detail lands where you left. One place
  reconciles URL ↔ saved list (`useActiveView`, canonicalizing with a history REPLACE);
  `uiStore.lastViewId` is only a persisted memory for cold launches and "← Queue".
- **One header component** (`layout/AppHeader`) owns the chrome for every screen — a screen
  passes slots, never its own `<header>`.
- **The PR detail side panes hide by UNMOUNTING** (`uiStore.prFilesOpen` / `prAgentOpen`, both
  persisted, toggled from the diff toolbar's panel icons): react-resizable-panels' `collapsible`
  lets a pane that lands at zero width during the group's first solve stay collapsed, which cost
  the agent pane its whole width on load. `onLayoutChanged` MERGES into the stored layout so a
  hidden pane's remembered width survives.
- **The stats facet is URL state too** (`/?view=<id>&by=<dim>:<value>`), client-side only: it
  never rewrites the GitHub search, so it costs no rate limit and stays honest about being a
  slice of what the view already returned.
- **View management lives on the tab** (⋯ menu / right-click / double-click to rename):
  rename · edit query · duplicate · delete (delete always confirms, then slides to the
  neighbour). Every write goes through `useViewActions`, which also owns the navigation.
- **Draft submit reads the server-side draft**, never a client payload.
- **prId is `"owner/repo#number"`** everywhere; runs key on `prId@headSha`.
- **Findings embed in their run record** (`runs.json`) — no separate findings store.
- **Failed runs don't auto-retry**; skipped/cached shas never re-run without explicit rerun.
- **Tests cover pure logic only** (shared/gh, pipeline parse/cluster/decide, stores' validators);
  UI components are not tested. New pure utils ship with tests, colocated as
  `<module>.test.ts` beside the module they cover — never named after the behaviour.
- **No unattended GitHub writes, ever.** The agent proposes; a human submits.
- **Chat proposes, the human applies** — the same rule one level down. A turn's edits to findings
  and staged comments arrive as chips; nothing is written until the click. That is what lets chat
  be conversational without touching invariant §1.
- **Chat is keyed by scope, not by thread list**: one conversation per (PR, sha[, finding]), no
  thread picker, no naming. The pane's focus decides what you are talking about.

## Pitfalls

- **A new `/api/*` family 404s in dev**: the Vite proxy forwards ALL of `/api` — but the Bun server
  must be RESTARTED to pick up new routes (no HMR server-side).
- **CodeView doesn't scroll / scrollTo dead**: container lost `overflow-y-auto` or bounded height.
- **Annotations don't move/appear**: item `version` didn't change — check `versionOf` inputs.
- **GraphQL 502s**: that's GitHub's ~10s budget. Never batch searches; keep the single retry.
- **Don't raise the queue page size.** MEASURED 2026-08-23: a 521-match `review-requested:@me`
  search already runs 6.5-6.8s at `first: 50`, and 504/502s start at 60. Trimming node fields
  doesn't buy it back — the same search with no check contexts and no threads still took
  7.5-9.3s at 100, so the cost is the SEARCH, not the payload. Removing the org-wide view
  didn't change this. More coverage needs a different mechanism (cursor paging on demand),
  not a bigger `first`.
- **`useQuery` detail-vs-queue thread counts differ**: queue fetches `reviewThreads(first:1)`
  totalCount only; `unresolvedThreadCount` is accurate only on detail. Same field with different
  args in one query is a GraphQL conflict — that's why detailQuery.ts doesn't reuse the fragment.
- **`reviewDecision` is null without branch protection.** GitHub only computes the repo-wide
  verdict when the BASE branch has a required-reviews rule; without one it stays null however
  many approvals a PR has. The badge (`ReviewCell`) and `reviewBucket` therefore read
  `viewerLatestReview` too and let YOUR verdict win — otherwise a PR you approved yourself
  renders "No review". Keep those two in step.
- **Approving your own PR 422s** — GitHub policy, surfaced verbatim (client.ts merges `errors[]`
  into the message; keep that, review submission errors live there).
- **bun-types must stay ~1.3.x** until webview-bun handles bun 1.4's `bigint` FFI Pointer type.
- **The TypeScript deps are deliberately crossed.** `tsc` — what `pnpm typecheck`/`build` run — is
  TypeScript **7.0.2 native**, installed under the `typescript7` alias. The bare `typescript` name
  is pinned to `@typescript/typescript6` because typescript-eslint (8.67, latest) declares its peer
  as `typescript: ">=4.8.4 <6.1.0"` and its parser needs that JS compiler API; it uses the same
  alias trick internally. Un-alias only once typescript-eslint ships a TS7 peer range — until then
  `typescript: ^7` breaks lint. `tsc6` is on PATH if you need the old compiler.
- **Zustand multi-key selectors need `useShallow`** (React 19 getSnapshot loop) — single-key
  selectors used everywhere so far.
- **`claude` CLI flags** (`--safe-mode --tools '' --permission-mode dontAsk`, plus
  `--include-partial-messages` for chat) verified against 2.1.239; `checkClaudeAvailable` only
  probes existence — re-verify flags on CLI major bumps.
- **A chat chip refuses to apply**: the finding moved state since the answer (staged, dismissed,
  rerun) — the message lands on the chip, that's the re-validation working, not a bug.
- **`ChatPanel` must stay mounted KEYED BY SCOPE**: the remount is what clears the composer draft
  and the streaming buffer. Resetting them in an effect is exactly what the React Compiler lint
  rejects (`react-hooks/set-state-in-effect`).
- **Chat's fence gate only hides ```json**: a reply whose LAST fence is a bare ``` block streams
  visibly and is then peeled off at turn-end — the persisted text is always the authoritative one.
