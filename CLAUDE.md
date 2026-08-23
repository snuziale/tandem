# Tandem

A GitHub review center with an inline agent: the agent pre-reads every PR in your queue and drafts
review comments into your **local pending review**; you triage them, add your own, and submit ONE
GitHub review as yourself. Built on the Sift skeleton (`~/code/my-jira`) — Bun + webview-bun native
app, Vite/React 19 SPA, Apollo Wind, TanStack Query, Zustand.

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
in reconcile. The data blocks and JSON output contracts in `pipeline/prompts.ts` stay code-owned —
they must match the zod schemas, and parse.ts re-enforces the rules regardless of prompt edits.
Pass 3 also emits a 0-100 merge-readiness `score` (stored on the run, shown in queue + pane) —
the auto-approve gate reads it.

Model output is untrusted (`pipeline/parse.ts`): last-JSON extraction → zod (`shared/
finding-schema.ts`) → ONE repair attempt → visible failure. Then deterministic re-enforcement:
findings must anchor to real diff lines (`diffLineIndex` in `shared/gh/patch.ts`), human-thread
duplicates drop, severity×confidence ranking under the caps (default 8 findings, 3 nits).

- **Runs are server-owned** (`live.ts`): closing the pane detaches; `POST /api/runs/:id/cancel` is
  the only kill switch. SSE = replay-then-tail in one synchronous block.
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
- The CodeView container MUST be the overflow parent (`overflow-y-auto` + bounded height) or
  nothing scrolls and `scrollTo` no-ops silently.
- `scrollTo` against virtualized estimates lands short — scroll twice (immediately + ~350ms).
- Split/unified via `options.diffStyle`; theming via `options.theme {dark, light}` +
  `options.themeType` (shadow DOM — Tailwind classes don't reach inside).

The FILE TREE is `@pierre/trees` (`components/pr/FileTree.tsx`): `useFileTree` constructs the
model ONCE — later state reaches rows through model methods, so `renderRowDecoration` reads a
ref (`stateRef`) and a `setGitStatus(freshArray)` call after viewed/agent changes re-renders the
visible rows. Git-status badges come from the PR's change types; decorations carry `+a −d`,
viewed ✓, and the violet agent dot. External selection follows the `selectedPath` prop
(select + scrollToPath). The tree owns its keyboard (arrows, a-z type-ahead, search) — the detail
key handler bails when the event target is inside `[data-tandem-filetree]`.

## Layout

```
src/
  shared/              client↔server bridge (tsconfig.server compiles ONLY server+shared)
    api-paths.ts  config-types.ts  github-schema.ts  review-types.ts  agent-types.ts
    finding-schema.ts (zod)  settings-types.ts  isPlainObject  runtime  user-agent
    gh/              runtime-neutral GitHub core, ALL TESTED: wire.ts (raw shapes),
                     normalize.ts, queueQuery.ts, detailQuery.ts, patch.ts (buildFilePatch,
                     splitRawDiff, diffLineIndex), generated.ts, prKey.ts (prId = "owner/repo#n")
  server/            Bun-only
    worker.ts (flat prefix router, port scan 5274-81, idleTimeout 0)  app.ts (webview host)
    runtime.ts  assets.ts (+generated asset-manifest.ts)  log  pathMatch  requestJson
    storage/jsonFile.ts   atomic temp+rename, 0600, PER-PATH mutation queue — the only
                          JSON persistence path; don't hand-roll another
    config/  github/{client,queue,pr,files,submit,routes}  reviews/  views/  settings/
    agent/   claude.ts (CLI harness)  procStream  live.ts  runsIndex.ts  prewarm.ts  routes.ts
             pipeline/{run,prompts,cluster,parse,context,decide}
  api/               plain-fetch clients (http.ts wrapper + per-family files)
  hooks/             useQueue (60s poll + focus refetch)  usePrDetail/usePrFiles (files:
                     staleTime Infinity per sha)  usePendingReview (optimistic)  useAgentRuns
                     (30s poll, byKey index)  useRunStream (SSE)  useSettings
                     useSavedViews (+ useViewActions: every view write + its navigation)
                     useActiveView (URL ↔ view list reconciliation)
                     useKeyboardNav (global dispatcher)  queueActions  findingActions
  state/             themeStore (persist)  uiStore (route, focus, composer target, lastViewId;
                     persist partialize: diffStyle + lastViewId)
  keyboard/          target.ts (isTypingTarget/hasOpenDialog)  shortcuts.ts (? sheet registry —
                     manually synced with the dispatchers)
  routes.ts          History-API routing: /?view=<id> · /:owner/:repo/pull/:n · /settings
                     (navigateToQueue() = back to the last-selected view)
  components/        layout/AppHeader (the ONE header: chrome + brand + agent pill + settings
                     + theme; screens fill `children`/`actions`) queue/ pr/ agent/
                     review(tray in pr/)/ settings/ setup/
```

## Storage (`$TANDEM_HOME ?? ~/.tandem`, all via jsonFile.ts, all 0600)

```
config.json    PAT (+defaultOrg)          settings.json  caps/threshold/models/repos
views.json     saved queue views          reviews.json   pending-review drafts by prId
runs.json      AgentRun by prId@headSha + spendByDay     claude.log  harness stderr
sandbox/       cwd for the read-only claude passes
localStorage   tandem:theme:v1 · tandem:ui:v1 (diffStyle, lastViewId) — display prefs ONLY
```

## Keyboard

Two dispatchers, one guard module (`keyboard/target.ts`), one display registry
(`keyboard/shortcuts.ts` — update it when touching either dispatcher):

- `useKeyboardNav` (mounted in App): `?` everywhere; queue keys j/k/Enter/o/a/A(override)/r//.
  Reads state via `getState()` snapshots — the listener never re-binds.
- `PrDetailView` binds its own detail keys (esc, [ ], j/k findings, y/e/x, v, r, a, o) — same
  snapshot pattern via a ref updated in an effect. Composer/tray own ⌘↵ (stage vs submit).

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
- **View management lives on the tab** (⋯ menu / right-click / double-click to rename):
  rename · edit query · duplicate · delete (delete always confirms, then slides to the
  neighbour). Every write goes through `useViewActions`, which also owns the navigation.
- **Draft submit reads the server-side draft**, never a client payload.
- **prId is `"owner/repo#number"`** everywhere; runs key on `prId@headSha`.
- **Findings embed in their run record** (`runs.json`) — no separate findings store.
- **Failed runs don't auto-retry**; skipped/cached shas never re-run without explicit rerun.
- **Tests cover pure logic only** (shared/gh, pipeline parse/cluster/decide, stores' validators);
  UI components are not tested. New pure utils ship with tests.
- **No unattended GitHub writes, ever.** The agent proposes; a human submits.

## Pitfalls

- **A new `/api/*` family 404s in dev**: the Vite proxy forwards ALL of `/api` — but the Bun server
  must be RESTARTED to pick up new routes (no HMR server-side).
- **CodeView doesn't scroll / scrollTo dead**: container lost `overflow-y-auto` or bounded height.
- **Annotations don't move/appear**: item `version` didn't change — check `versionOf` inputs.
- **GraphQL 502s**: that's GitHub's ~10s budget. Never batch searches; keep the single retry.
- **`useQuery` detail-vs-queue thread counts differ**: queue fetches `reviewThreads(first:1)`
  totalCount only; `unresolvedThreadCount` is accurate only on detail. Same field with different
  args in one query is a GraphQL conflict — that's why detailQuery.ts doesn't reuse the fragment.
- **Approving your own PR 422s** — GitHub policy, surfaced verbatim (client.ts merges `errors[]`
  into the message; keep that, review submission errors live there).
- **bun-types must stay ~1.3.x** until webview-bun handles bun 1.4's `bigint` FFI Pointer type.
- **Zustand multi-key selectors need `useShallow`** (React 19 getSnapshot loop) — single-key
  selectors used everywhere so far.
- **`claude` CLI flags** (`--safe-mode --tools '' --permission-mode dontAsk`) verified against
  2.1.239; `checkClaudeAvailable` only probes existence — re-verify flags on CLI major bumps.
