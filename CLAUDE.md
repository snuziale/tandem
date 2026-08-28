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
   `maybeAutoApprove` in `pipeline/run.ts` post an empty APPROVE when EVERY gate holds — the run
   came from the DEFAULT agent profile, pass-3 score ≥ threshold, zero undismissed blocker/risk
   findings, checks green (unless waived), not a draft, and no human draft in progress. Never
   widen those gates silently. The profile gate is why a lens can never approve: a specialized
   profile scores high by looking at ONE subject, so a performance sweep finding no performance
   problems is not a statement that the change is sound.
2. **Pre-warming hides latency — but automatic runs are OPT-IN** (user decision 2026-08-21,
   overriding the spec's default). `settings.autoRunEnabled` is false by default: the queue sweep
   only does maintenance (staleness marking, draft re-anchoring); model runs start from the rerun
   button / `r`. When the user flips it on, every queue poll feeds `server/agent/prewarm.ts`,
   cached by `(prId, headSha)`.
3. **Violet = machine-authored, nowhere else.** `--tandem-agent*` tokens in `src/index.css`. Queue
   agent cell, file-tree dots, finding rails/labels, agent rows in the tray. Never reuse it.

## Running / verifying

```bash
pnpm dev:all        # native window + Vite (or `pnpm start` + `pnpm dev` in two terminals)
pnpm dev:web        # same pair, headless (`pnpm serve` + vite) — no host webview needed
pnpm test           # pure logic: normalizers, queue query, patch index, parse/caps, decide, routes
pnpm typecheck      # gen manifest + tsc -b (3 projects: app / node / server)
pnpm lint
pnpm build:app      # macOS .app; a bare executable on Windows/Linux (scripts/build-app.ts)
TANDEM_HOME=/tmp/x pnpm start   # scratch home — don't pollute ~/.tandem while testing
```

`start` hosts the server inside `app.ts`'s webview; `serve` runs `worker.ts`
alone. They are the SAME server — the window is the only difference, and it
renders the last `pnpm build`, not Vite's HMR output.

Dev needs BOTH processes: the Vite proxy forwards ALL `/api/*` to the Bun server (first free port
from 5274, `$TANDEM_SERVER_PORT`). There is no env-driven auth in the Vite config — credentials
live server-side only. `GITHUB_TOKEN` env seeds `~/.tandem/config.json` on first run.

## How requests flow

```
browser → /api/* → Vite proxy (dev) → Bun server (src/server/worker.ts)
  /api/config/*    config/routes.ts      PAT store, /user probe (login), test/save
  /api/queue       github/queue.ts       one GraphQL search PER VIEW, parallel (see below)
  /api/prs/:o/:r/:n[...]  github/routes.ts  detail (GraphQL) · files (REST+fallback) ·
                                            blob (one file at a commit, for diff-pane
                                            context expansion) ·
                                            asset (an attachment's bytes — see below) ·
                                            approve · submit  ← the only two GitHub writes
  /api/reviews/:prId  reviews/routes.ts  local pending-review draft (GET/PUT/DELETE)
  /api/views       views/routes.ts       saved queue views (created/edited on the queue's tabs;
                                         Settings › Views round-trips views AND teams together —
                                         utils/configJson.ts validates imports)
  /api/teams       teams/routes.ts       named lists of GitHub logins (GET/PUT, like views)
  /api/pulse[...]  pulse/routes.ts       .xbar → menu-bar plugin text · /history → daily rollup
                                         · plain GET → JSON. All read-only.
  /api/seen        seen/routes.ts        last-seen per PR (detail marks; queue shows the
                                         unseen-changes dot when updatedAt moved past it)
  /api/settings    settings/routes.ts    caps, threshold, models, per-repo agent toggle,
                                         prompts (see below)
  /api/runs[...]   agent/routes.ts       run records · /activity (small live readout for the
                                         header strip) · SSE stream · cancel · finding state
  /api/chats[...]  agent/chat/routes.ts  chat turns · SSE token stream · cancel · apply/reject
                                         one proposed action (the only state-changing chat call)
  /api/agent/health                      claude CLI availability
  /*               assets.ts             SPA (embedded via asset-manifest in the binary)
```

**Queue divergence from the spec**: views are NOT batched into one aliased GraphQL request. A
batch's execution time is the sum of its searches and GitHub kills GraphQL around ~10s (502); an
org-wide view alone runs ~9s. One request per view, in parallel — same rate-limit points, per-view
errors, and a single 502-retry in `github/client.ts`. A team-backed view extends the SAME shape
one level down (see below): its query is chunked and each chunk is another parallel search, under
a global `MAX_SEARCHES_PER_POLL` so a few team views can't turn one poll into forty searches.

## The agent pipeline (server/agent/)

`pipeline/run.ts` orchestrates three passes per `(prId, headSha)`, each a read-only headless
`claude -p` one-shot (`claude.ts`; prompt over stdin, result frame parsed for text + usage):

1. **Orient** (haiku): PR meta + file list + `.tandem/conventions.md` + recent commits → a 3–6 item
   review plan. A failed orient degrades to a generic plan, never fails the run.
2. **Analyze** (sonnet): per file cluster (`cluster.ts`: top-dir grouping, ≤8 files/≤800 lines) →
   candidate findings as strict JSON.
3. **Reconcile** (sonnet): candidates + existing human threads → deduped, ranked, capped final set
   - run summary. This pass keeps output signal-dense; do not skip it.

**Agents are configurable profiles** (`settings.agents: AgentProfile[]` + `defaultAgentId`): each
profile carries its own per-pass models and prompt instruction blocks, so agents can specialize
(security sweep, test-coverage, …). Runs record `agentId`/`agentName`; the pane's rerun menu can
run any profile; prewarm/plain reruns use the default. Legacy top-level `models`/`prompts`
migrate into the default profile on load (settings/store.ts sanitizeAgents). Defaults live in
`shared/prompt-defaults.ts` (per-field reset in Settings); `{findingCap}`/`{nitCap}` interpolate
in reconcile.

**A profile starts from a LENS, not a blank box** (`shared/agent-presets.ts`, TESTED): four
presets — correctness, architecture, React, performance — each a focus sentence, a concrete
checklist and ONE guard naming that lens's characteristic noise ("never propose a rewrite of code
the PR only touched", "name the N at which it hurts"). A preset EXTENDS the shared defaults, it
never replaces them: the line-anchoring contract, the caps and the score definition stay written
once in `prompt-defaults.ts`, so a lens can only say what to look AT. The preset is COPIED into
`settings.agents` when the profile is created — text belongs to the profile from then on, and an
upgrade never rewrites a tuned prompt. `presetId` rides along so that ONE question — what are this
profile's prompt defaults — has one answer (`promptDefaultsFor`): a prompt field's "reset to
default" and its "customized" badge read it, and `sanitizeAgents` rehydrates a missing block from
it, so an untouched preset block is never rendered as edited. A profile carries a fourth model + prompt for the chat pass (see below). The data blocks and JSON output contracts in `pipeline/prompts.ts` stay code-owned —
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

- **The answering PROFILE follows the run, and the SERVER reads it.** `startChatTurn` resolves it
  as `opts.agentId ?? (await getRun(prId, headSha))?.agentId`, so asking "why did you flag this?"
  of an architecture run reaches the architecture reviewer — without the client shipping back a
  fact the run record already holds (the pane's copy comes from a 30s poll). The wire field stays
  as an override for an "ask another lens" affordance that does not exist yet. Scope is unchanged:
  the conversation is still keyed by (PR, sha, finding), so a rerun under another profile does not
  fork it.
- **Scope is the identity.** `chatKeyOf(prId, headSha[, findingId])` is the session id, the storage
  key, and the URL segment — so opening a finding's thread is a plain GET with no create call, and
  a new head sha is a new conversation. The pane's focused finding IS the scope (`ChatPanel` is
  mounted keyed by it).
- **Stateless multi-turn, not CLI session resume.** Each turn rebuilds
  `[immutable context] + [transcript] + [question]` (`chat/prompt.ts`) — stable prefix first, so
  prompt caching pays for the diff instead of us re-paying per message. Transcripts live in
  `chats.json`; `--no-session-persistence` stays.
- **Prose first, actions in an OPTIONAL trailing ``json fence** (`chat/prose.ts`): strict JSON is
not the product here, so an unparseable tail degrades to prose-only instead of failing the turn.
`createFenceGate` hides the fence while it streams (only ``json — a ```ts snippet still
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
- **A comment can span LINES, and the anchor is always the LAST one** — `line` with an optional
  `startLine`, exactly GitHub's `line`/`start_line`, so the card hangs under the end of the range.
  Everything below the UI already spoke this (threads, findings and `restCommentOf` all carry
  it); the pane is what learned to produce it. See the diff-pane note on selection.
- **Submit posts the server-side draft**, not a client payload: `POST …/submit {verdict, summary}`
  → suggestion fences composed, `commit_id` = draft sha, per-comment 422s surfaced, drafts with
  `anchorMoved` comments refused (409). Success clears the draft.
- Blocker gate (guard rail, not a block): quick-approve disabled + `a` refused while an undismissed
  blocker exists; `shift+A` overrides; APPROVE submit blocked the same way.

**Attachments are proxied, and that is not optional** (`shared/gh/attachments.ts` TESTED +
`server/github/assets.ts`). GitHub puts `github.com/user-attachments/assets/<uuid>` in the raw
markdown `body` — a URL a browser can NEVER load. It is authenticated by a github.com SESSION
COOKIE (plus SAML for an SSO org): an `<img>` from the app sends none (cross-site, the cookie is
SameSite=Lax) and a PAT cannot ride on an `<img>` at all. Unauthenticated it 404s; with a bearer
PAT it answers a sign-in page.

- **`bodyHTML` is the only place a loadable URL exists** — GitHub rewrites the asset to a signed
  `private-user-images.githubusercontent.com/...?jwt=` URL needing no auth whatsoever. So the
  detail query fetches `bodyHTML` beside `body`, for the PR and every thread comment, and reads
  exactly two things off it: the signed URL and whether GitHub rendered an image or a video.
- **The JWT lives 300 SECONDS**, which is why the signed URL is never handed to the client. The
  uuid is the durable name; `/api/prs/:o/:r/:n/asset/:uuid` re-resolves per request (map cached
  per PR for 120s, comfortably inside the JWT's life) and streams the bytes, forwarding `Range` so
  a video can seek. Don't "simplify" this by putting the signed URL in the markdown — a pane open
  five minutes would go blank.
- The rewrite happens in `normalize.ts`, so EVERY reader downstream (description, thread card,
  agent prompt context) sees the working form. A uuid `bodyHTML` didn't resolve is left exactly as
  written — which is also what makes this a no-op on any response fetched without `bodyHTML`.
- **A bare attachment URL on its own line becomes the element itself**, `<video controls>` or
  `<img>`, because that is what GitHub does with one and the markdown cannot say which it is.
  Hence `Markdown.tsx` widens the sanitize schema: hast-util-sanitize follows GitHub's MARKDOWN
  allowlist, which has no `video` at all.

## Teams and pulse (the cohort half)

The queue answers "what must I review?". A second question — "how is my team's work doing?" —
needs two things the queue never had: a durable set of PEOPLE, and a reading of each PR that says
whose court the ball is in. Both are pure and shared, because the server (the menu-bar feed)
needs them as much as the client does.

**A team** (`shared/team-types.ts`, `server/teams/`, `~/.tandem/teams.json`) is a name and a list
of GitHub logins. That is the entire type. A richer one was built first — display names, emails,
managers, repos, a `gh-team`/`org-members` sync, a paste-and-filter importer — and every field
beyond the login was carried around without being read, so it was cut (user decision 2026-08-27).
Don't add a field back without a consumer. Teams are edited in **Settings › Teams**; the editor
itself is `components/teams/TeamsPanel.tsx`, and `queue/TeamDialogs.tsx` is only a dialog frame
around that same panel for ONE path — the view editor, where discovering mid-query that the team
doesn't exist yet must not throw away the half-written view.

A view references a team (`SavedView.teamId`) and reaches it through ONE token, `{team}`, which
stands in for a person wherever a person can go:

```
author:{team}            → author:alice author:bob
review-requested:{team}  → review-requested:alice review-requested:bob
{team}                   → author:alice author:bob      (bare = authors)
```

The qualifier the token is attached to is the one that repeats, so the query keeps saying what it
does. The query bar shows the raw string and prints the expansion under it, never in place of it.

- **Expansion and sharding are one pure module** (`shared/gh/team.ts`, tested).
  `shardTeamQuery` chunks the logins 8 at a time and returns ONE QUERY PER CHUNK — that is how a
  25-person team gets full coverage without touching `first: 50`, which is measured and must not
  move. It is the single reason a team beats typing the logins into the query yourself.
- **An empty expansion is an ERROR, never a query.** `author:{team}` over a team with no members
  would leave `is:pr is:open archived:false`, which matches all of GitHub. The view fails loudly
  instead — that is also why a deleted team leaves `teamId` in place.
- Shards are deduped by prId and their `issueCount`s summed; per-view `shards` comes back in the
  queue response and shows on the tab as `×n`.

**Row ORDER is GitHub's, and the queue must not re-sort it** (`dedupePrs` in `shared/pulse.ts` is
order-preserving; TESTED). A view's query owns its own `sort:` qualifier, and the `first: 50`
window GitHub returns is chosen in that same order — so sorting the rows afterwards shows the
first 50 of ONE ordering arranged by ANOTHER, and a long-open PR touched a minute ago is missing
from the queue entirely rather than sitting at the top. `dedupePrs` used to end in `byUpdatedDesc`
and ran on every view including single-shard ones, which is exactly that bug plus a `sort:` in the
query bar that could never reach the table. The two callers with no order to honour sort for
themselves: a SHARDED team view (N searches end to end is N sorted runs, not one) and the
menu-bar feed (several views concatenated), both newest-first.

**Pulse** (`shared/pulse.ts`, tested) maps every PR onto exactly one attention state:
`blocked-on-you · rotting · blocked-on-them · ready · moving`. The ORDER of those rules is the
design and is spelled out in the file — a draft is always moving; your own action outranks
everything; `ready` beats `rotting` (an approved green PR sitting two weeks is a merge click, not
rot); then rot, because "three weeks untouched" is the story. `blockedOn()` is separately testable
and answers author/reviewer/neither without knowing who you are.

- Inputs come from four cheap fields added to `PR_SEARCH_FRAGMENT`: `comments { totalCount }`,
  `autoMergeRequest`, and `approvals`/`changesRequested` as ALIASED `reviews(states:)` totalCounts
  (aliases are the only way to ask twice in one selection set), plus `reviewRequests(first: 10)`.
  All optional in the normalizer — a response without them reports zero, never a wrong state.
- **A team review request never counts as YOURS**: membership isn't resolvable from a search
  response, so `awaitsViewer` only matches a direct user request. Same discipline as the null
  `reviewDecision` rule: degrade honestly rather than guess.
- `settings.pulse.rottingDays` is a SETTING because it is a team norm, not a fact. Every "rotting"
  mark in the app is drawn against that one number.
- It surfaces in four places, all fed by ONE `usePulseOptions(now)`: the queue's pulse column, the
  breakdown's strip + tiles, the header `PulsePill`, and the menu-bar feed. `usePulseOptions`
  MEMOIZES its result — it is a useMemo dependency in three of them. Never compute pulse from
  anywhere else, or two surfaces will disagree.

**The queue table is FLAT, and grouping is a menu-bar concern only** (user decision 2026-08-27).
`groupPullRequests` in `shared/pulse.ts` exists for `shared/xbar.ts`: a pulldown has no columns to
read across, so it needs headings. The table has columns, and the pulse pill slices it faster than
a grouping control would — so there is no group toggle, no `&group=` URL param and no `g` key.
Don't reintroduce them in the table; `?group=` on `/api/pulse` is the feed's own knob.

**Trend**: `~/.tandem/pulse.json` keeps ONE row per view per day — five integers and a total, last
write wins, 90-day cap (`shared/pulse-journal.ts`, tested; written fire-and-forget after the queue
response). The drawer's sparkline is the only trend in the app and reads only this. The stats
drawer stays a snapshot; a real per-PR history is a different feature with a different store.

**The menu bar** (`shared/xbar.ts`, tested + `server/pulse/routes.ts`): Tandem serves its own
xbar / SwiftBar plugin, so `scripts/tandem-pulse.5m.sh` is one `curl`. The point is that a
menu-bar PR plugin needs a token, a team list, a staleness rule and a definition of "needs me" —
Tandem owns all four, so the glanceable surface and the app cannot drift apart.
`?view=` `?team=` `?group=` override per plugin. **A true native tray is deliberately NOT built**:
webview-bun exposes no menu API (`app.ts` bridges even Quit), so it is a Swift-helper project, and
the served plugin gets ~90% of it today.

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
- **Hide whitespace is OURS, not the library's** (`hideWhitespaceChanges` in `shared/gh/patch.ts`,
  toggled from the diff toolbar / `w`, persisted in `uiStore.hideWhitespace`): @pierre/diffs has no
  such option, so we rewrite the patch — a deletion and an addition that differ only in whitespace
  collapse into ONE context line, and a hunk left with no real change is dropped (the file then
  renders as an empty diff under a "whitespace only" header tag). **Line numbering is preserved
  exactly** — a collapsed pair consumed one old + one new line and so does its context line, so the
  `@@` counts never move and every anchor, line click and `scrollTo` still addresses the same
  lines. Annotated lines (threads, staged comments, findings, the composer) are passed in as
  `KeepLines` and never fold, or their cards would vanish with them.
- **Unmodified context expands, and it costs ONE fetch** (`components/pr/expandContext.ts`):
  a patch-parsed diff is `isPartial`, so the library shows no expand chevron until
  `options.loadDiffFiles` can hand it both full sides — supplying that loader IS the feature
  (the chevrons, the 20-line chunking, shift-click-for-everything are all the library's).
  The loader fetches only the NEW file (`GET …/blob?path=&sha=`, cached per commit through
  the query client) and derives the old side with `reversePatch` (`shared/gh/patch.ts`,
  TESTED against live PRs): outside the hunks both sides are identical by definition and
  inside them the `-` lines are the old text verbatim. Do NOT "fix" this by fetching the base
  file — we carry no base oid, and the base BRANCH tip is not the merge base GitHub diffed
  against, so a moved base would render context that disagrees with the patch. Reverse the
  patch the pane is CURRENTLY showing (the hide-whitespace rewrite when that toggle is on),
  or a folded pair's stand-in line re-exposes its whitespace on the left.
- **Expanded lines are NOT commentable.** They sit outside the diff and GitHub's review API
  rejects a comment there, so `onLineClick` bails on `isCommentableLine` (`annotations.ts`,
  where this pane's library↔app vocabulary lives) — otherwise the comment stages fine and
  dies with a per-comment 422 at submit.
- **Multi-line comments are the LIBRARY's selection, not a gesture of ours**
  (`enableLineSelection` + `enableGutterUtility`): a drag starts on the line-NUMBER column only,
  so selecting text in the code still works, shift-click extends, and the ⊕ the library parks on
  the hovered number is the same gesture with a handle — and the reason anyone discovers it.
  Both paths commit through ONE callback (`onLineSelected` → `commitSelection` → the pure
  `commentAnchorOf`, tested); the ⊕ needs
  `onGutterUtilityClick` present to arm, which is why that one is an empty function.
  `onLineNumberClick` is empty for the mirror-image reason — a number click IS the one-line
  selection, and letting it fall through to `onLineClick` would open the composer twice.
- **A dragged range is clamped against the PATCH, never trusted** (`clampCommentRange`,
  `shared/gh/patch.ts`, tested): it keeps the contiguous run of patch lines ending at the anchor.
  Expanded context and the gap between hunks are both simply absent from the patch, so a
  selection dragged into either stops at the hunk edge — which is also what GitHub requires,
  since it rejects a range spanning a hunk boundary. A split-view drag that crossed sides is not
  one comment: it falls back to the line the pointer ended on. That translation — side
  defaulting, the crossed-drag rule, the clamp — is `commentAnchorOf` in `annotations.ts`, not
  the component, so it is testable. The clamp also re-checks a staged range after new commits
  (`prewarm.ts`), because `start_line` moving is a moved anchor. The index it reads is built once
  per parse and rides in `diffByPath` beside the patch it came from.
- **Selection is uncontrolled, and `composerTarget` is what it mirrors.** No `selectedLines`
  prop: the library paints a drag itself with no React work per pointermove, and an effect writes
  the committed state back through the handle, so the highlight outlives the drag and dies with
  the composer. That one slot is lent out by precedence — composer, then the focused staged
  comment or human thread (`uiStore.focusedCommentId`, set by clicking the card; click it again
  to give the selection back), then the focused finding — so a card that spans lines shows its
  HEIGHT rather than just its anchor, whoever authored it. At most one of `focusedCommentId` /
  `focusedFindingId` is ever set: their setters clear each other, and opening a composer clears
  both, because two cards wearing a focused border would be a lie about a single selection.
  A thread with a null `line` is outdated against this diff and claims nothing. Ranges are in
  `versionOf` and in the fold map (`annoSpan`): extending one has to re-render the card (the
  library hands the render prop the annotation IT holds), and a folded middle would leave a card
  pointing at half its own evidence.
- **⌥↑/⌥↓ move the TOP of an open composer's range**, never the anchor — the card would jump out
  from under the cursor mid-sentence. ⇧↑/⇧↓ is deliberately not used: it selects text in the box.
  The card owns those keys, so it has to own FOCUS: @pierre/diffs does NOT preventDefault the
  line-number pointerdown, so a drag focuses the CodeView root (the library puts `tabIndex = -1`
  on it — that is our scroll container), and the arrow keys scroll the diff instead. Dragging on
  an already-open composer is the case that bites, since the card never remounts to re-run
  `autoFocus`. `ComposerCard` reclaims focus on every range change, but only when it actually
  left the card, and returns it to whichever box last had it.
  Ticking "suggested change" seeds the box with the range's own text (`patchLineText`, tested),
  since a suggestion IS a replacement for those lines. That seed is DERIVED, not copied into
  state: the box shows `edited ?? sourceText`, so it follows the range for free until someone
  types in it. The handler sits on the CARD, not the body textarea, so ⌥ arrows still work from
  inside the suggestion box — the one place the re-seed is for.
- **One convention, one place**: the anchor is the END line and `startLine` is absent when there
  is only one. `spanOf`/`startLineOf` (`annotations.ts`) are the only spelling of it — `annoSpan`,
  the selection mirror, the composer's label and the staged card all read them.
- **The parsed `fileDiff`'s IDENTITY is load-bearing**: the loader hydrates that exact object
  in place and the library keys expansion state to it (`fileDiff !== this.fileDiff` resets the
  file), so the parse must hold still while the patch text does — `parsePatchFiles` has no
  cache of its own. Keep it and its patch paired: the loader refuses a `fileDiff` it wasn't
  handed with that patch rather than reversing another one against it.
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
    team-types.ts  pulse.ts (TESTED: states, blockedOn, grouping)
    agent-activity.ts (TESTED: live-registry ↔ run-record reconciliation, today's tally)
    pulse-journal.ts (TESTED)  xbar.ts (TESTED: the menu-bar plugin renderer)
                     kebab-case here; gh/ below is a camelCase sub-package. `-schema` means
                     zod (chat-schema, finding-schema); plain data is named for what it holds.
    gh/              runtime-neutral GitHub core, ALL TESTED: wire.ts (raw shapes),
                     attachments.ts (the uuid↔signed-URL join + markdown rewrite),
                     normalize.ts, queueQuery.ts, detailQuery.ts, patch.ts (buildFilePatch,
                     splitRawDiff, diffLineIndex, clampCommentRange, patchLineText),
                     generated.ts, prKey.ts (prId = "owner/repo#n"),
                     team.ts ({team} expansion + sharding)
  server/            Bun-only
    worker.ts (flat prefix router, port scan 5274-81, idleTimeout 0)  app.ts (webview host)
    runtime.ts  platform.ts (IS_WINDOWS/IS_DARWIN)  assets.ts (+generated
    asset-manifest.ts)  log  pathMatch  requestJson
    storage/jsonFile.ts   atomic temp+rename, 0600, PER-PATH mutation queue — the only
                          JSON persistence path; don't hand-roll another
    config/  github/{client,queue,pr,files,submit,routes}  reviews/  views/
    settings/  teams/{store,routes}  pulse/{journal,routes}
    agent/   claude.ts (CLI harness)  procStream  live.ts (runs + chat)  sse.ts (replay-then-
             tail, shared)  runsIndex.ts  prewarm.ts  routes.ts
             pipeline/{run,prompts,cluster,parse,context,decide}
             chat/{turn,prompt,prose,actions,context,store,routes}
  api/               plain-fetch clients (http.ts wrapper + one file per resource, named for
                     the resource: config, settings, queue, prs, reviews, runs, seen, views,
                     teams, pulse)
  hooks/             useQueue (60s poll + focus refetch)  usePrDetail/usePrFiles (files:
                     staleTime Infinity per sha)  usePendingReview (optimistic)  useAgentRuns
                     (30s poll, byKey index)  useRunStream (SSE)  useChat (transcript + turn
                     stream + apply)  useSettings
                     usePulse (usePulseOptions — the ONE source of viewer + rottingDays —
                     and usePulseHistory)  useTeams (+ useTeamActions)
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
                     /:owner/:repo/pull/:n · /settings/<section>
                     (navigateToQueue() = back to the last-selected view AND facet;
                     navigateToSettings() = the rail's first page)
  utils/agentFormat.ts TESTED duration/spend/PR-ref/file-name formatting, shared by the
                     agent pane, the header strip and the tray
  utils/queueStats.ts  TESTED pure stats + facets over the active view's rows
                     (buckets, top-N folding, parse/format/match facet; `pulse` is the one
                     facet dim needing context, hence the optional PulseOptions arg)
  components/        layout/AppHeader (the ONE header: chrome + brand + agent strip + settings
                     + theme; screens fill `children`/`actions`) queue/ pr/ agent/
                     review(tray in pr/)/ teams/ (TeamsPanel, framed by the settings
                     section AND the view editor's dialog)/ settings/ (SettingsView
                     shell + fields.tsx + one file per sections/) setup/
                     common/ (Markdown, ErrorBoundary, ShortcutsHelp) — every component
                     lives in a subdirectory, none at the root
```

## Storage (`$TANDEM_HOME ?? ~/.tandem`, all via jsonFile.ts, all 0600)

```
config.json    PAT (+defaultOrg)          settings.json  caps/threshold/models/repos/pulse
views.json     saved queue views          reviews.json   pending-review drafts by prId
teams.json     named lists of GitHub logins (no defaults — a team is a claim about people)
pulse.json     ONE row per view per day: five pulse counts + total, 90-day cap
runs.json      AgentRun by prId@headSha + spendByDay     claude.log  harness stderr
chats.json     ChatSession by prId@headSha[#findingId], LRU-capped at 100
seen.json      last-seen updatedAt per prId (drives the unseen-changes dot)
sandbox/       cwd for the read-only claude passes
localStorage   tandem:theme:v1 · tandem:ui:v1 (diffStyle, hideWhitespace, lastViewId,
               panes + stats toggles) — display prefs ONLY
```

## Keyboard

Two dispatchers, one guard module (`keyboard/keyOwnership.ts`), one display registry
(`keyboard/shortcuts.ts` — update it when touching either dispatcher):

- `useKeyboardNav` (mounted in App): `?` everywhere; queue keys
  j/k/Enter/o/a/A(override)/r/s/esc//. Reads state via `getState()` snapshots — the listener
  never re-binds.
- `PrDetailView` binds its own detail keys (esc, [ ], j/k findings, y/e/x, c chat, v, w, r, a,
  o) — same snapshot pattern via a ref updated in an effect. **`esc` closes the composer and
  nothing more** (user decision 2026-08-27): it used to fall through to leaving the PR, which read
  as losing your place. Esc dismisses what is in front of you; leaving is "← Queue" or browser
  back. Composer/tray own ⌘↵ (stage vs submit) — the
  tray's is a WINDOW listener that bails on `isTypingTarget`, which is why a text box can claim
  ⌘↵ for itself. The chat composer is the one box that sends on plain ↵ (⇧↵ = newline, ⌘↵ still
  works): it is a chat box, and overloading ⌘↵ a third time reads as ambiguous.

**A key is ALWAYS a `<kbd>`, and there is one of them** (`components/common/Kbd.tsx`). Every
surface that names a shortcut renders through `Shortcut` — the `?` sheet, Settings › About's copy
of it, tooltips (`Back to queue ⎋`), inline affordances (`rerun r`, `Submit review ⌘↵`), the chat
composer's send hint, a settings hint, and a toast (`ShortcutHint`, built with `createElement`
because the dispatcher has no JSX). "press r" as bare prose reads as a sentence, not as something
you can hit.

- The chip is drawn in `currentColor`, never a named token: it appears on the page background AND
  inside a tooltip's inverted surface, and a fixed border/text color is legible on exactly one of
  those. Sized in `em` so it tracks 10px hints and 13px sheet rows without a size prop. The
  `.tandem-md kbd` rule in `index.css` is the same chip for a `<kbd>` in PR markdown — keep them
  in step.
- **`MOD`/`ALT`/`SHIFT` are BARE** (`keyboard/platform.ts`): no trailing `+`. Whether a chord is
  spelled solid (⌘↵) or with a plus (Ctrl+Enter) is a rendering convention and lives in `Kbd`,
  which prints the `+` only off macOS. A chord is written `${MOD}+↵`.
- **`shortcuts.ts` separates keys from prose**: `{ keys, gesture?, action }`. A key renders as a
  chip and a mouse gesture does not, so the sheet can never print "click a line" inside a key cap;
  an `action` never names a key either, so an alternative spelling goes in `keys` and stays styled.
  Both readers (the `?` sheet and About) right-align that column — ragged chips read as a list of
  words rather than of keys.
- A hint on a DISABLED control needs the tooltip on a wrapper (`QueueRow`'s Approve): a disabled
  button fires no pointer events for a tooltip — or a native `title` — to hang on. That is also
  why nothing prints a shortcut into a `title` attribute: it cannot be styled.

## Queue table cells

Eight columns (`QUEUE_GRID` in `QueueRow.tsx`), and two rules hold the column edges still:

- **The hover actions own the last column.** They used to share the agent cell behind a
  `justify-between`, so the widest agent state — a findings tally, a score meter and severity
  chips — competed for width with two buttons that are invisible most of the time. They stay
  `invisible`, never `hidden`, so hovering still never reflows the row.
- **Review and agent cells are always TWO lines**, whether or not the second has content:
  `SignalsCell` renders an empty track for a PR with no reviews or comments, and `AgentCell`
  reserves its severity-chip row in every state including "—". Before that, a one-line state and
  a two-line state centred differently, so the two most-scanned columns slid up and down against
  the six that never move.

## Queue header zones

One fixed-height row, and NOTHING in it wraps — so the rule has to be visible rather than
emergent. `ViewTabs` is the only `flex-1` child and the only thing that scrolls (`overflow-x-auto`
on its strip), which means every control to its right keeps the same position whether there are
two views or twelve. A `HeaderDivider` marks where the tab strip ends and the ACTIVE VIEW's own
controls begin — pulse pill, breakdown toggle, query toggle — followed by the agent strip and
settings. `AppHeader` has NO `actions` slot as of 2026-08-28 — the queue was its last caller, and
teams and the views/teams JSON round-trip moved into Settings, because neither is a thing you do
to the queue you happen to be looking at. A screen's own controls go in its middle zone
(`children`); the right-hand group is app-level and identical everywhere. Put a new control in
the zone it belongs to; do not add a second row, and prefer Settings over a ninth icon here.

## Agent status strip (`components/agent/AgentStatusStrip.tsx`)

The header's agent readout, and the ONE place outside a PR that answers "what is the agent doing
right now?". It replaced a dot plus the words "2 running" — one bit rendered out of a model that
already carried the rest.

- **`/api/runs` ships `live: LiveWork[]`**, derived in `server/agent/live.ts` from the frames the
  passes ALREADY publish — nothing new is emitted to produce it, so a run that says nothing on the
  wire says nothing here rather than inventing progress. `publish()` stringifies immediately and
  the pipeline then MUTATES the step object it published, so scanning `events` for the running step
  reads the same truth the SSE stream does, with no second bookkeeping path to drift. Runs AND chat
  turns appear, told apart by `kind` exactly as `liveCount` tells them apart — a streaming turn is
  work the user is waiting on and was invisible outside the pane it streamed into.
- **In flight = the registry RECONCILED with the run records** (`shared/agent-activity.ts`,
  tested, run SERVER-side). The registry is in-memory and per-process: two servers can share
  `$TANDEM_HOME` (the native app and a dev server beside it), so a run genuinely analyzing in the
  sibling process looks idle in this one's registry. `inFlightWork` therefore adds every active
  run the registry doesn't have, described from its own persisted `steps` — but EXCLUDES an
  interrupted one, reusing the same `isInterrupted` window the startup sweep uses (moved to
  `shared/agent-types.ts` for exactly this reason: one window, one answer, so the strip and the
  sweep cannot disagree about which runs are real). The registry's entry wins on a tie — a
  persisted step lags the frame that produced it by one write. "Recent" is then simply everything
  NOT active, which keeps a run mid-analysis from being filed under finished work.
- **Two queries, opposite shapes — do not merge them back.** `GET /api/runs/activity`
  (`useAgentActivity`) answers "what now?" in a payload that does not grow with history — MEASURED
  2026-08-28: **86 bytes vs 336KB** for `/api/runs` at 70 runs. That is why the strip's 2s poll is
  affordable; putting `live` on the runs snapshot meant re-reading, re-parsing and re-shipping
  every run WITH its findings and steps every two seconds, and re-running `select` once per
  subscribed component (two on the queue screen, where it also churned 50 table rows). `useAgentRuns`
  stays at 30s. The activity query is keyed `["runs", "activity"]` ON PURPOSE: the eight existing
  `invalidateQueries({ queryKey: ["runs"] })` call sites match it by prefix, so none of them has to
  know it exists.
- **The trigger's width is FIXED (168px)** and every line inside truncates. It is the leftmost
  thing in the app-level header zone, so a strip that grew with a longer step label would slide the
  ⚙ sideways every few seconds — the same rule that keeps `ViewTabs` the only `flex-1` child.
- **Three segments, one per pass, and the live one carries a comet — never a percentage.** Each
  pass answers with a single strict-JSON blob, so there is no measurable fraction inside one; a bar
  jumping 0→33→90 would be a claim nothing measured. Which pass, plus visible motion, is all that
  is known. Animation is CSS-only and composited (`.tandem-comet` in `index.css`, two sweeps
  staggered for a trail), `motion-safe:` gated, and **violet only** — a second hue in the app's most
  prominent chrome would be the loudest possible break of invariant §3.
- **Idle is a readout, not the word "idle"**: runs today, open findings, failures — counted
  client-side from the snapshot's own run list, so no server counter can disagree with it. Static
  on purpose; motion in the header is reserved for work actually happening.
- **Detail lives in the tray, one click away, never in a second header row**: in-flight rows naming
  the files the current step is READING (`RunStep.paths` — the difference between "busy" and "it
  has my code open"), queued runs (the prewarm cap made visible), the last six finished runs, spend
  against the daily ceiling, and a claude-CLI health line. Cancel goes through the same
  `POST /api/runs/:id/cancel` the pane uses — runs are server-owned, so it is a real kill switch.

## Query help (`components/queue/QueryHelp.tsx`)

The query stays RAW — but a raw string only reads as an invitation once you know the vocabulary,
and nothing in the app ever said `repo:owner/name`, so a first view was a guess. One popover
(`QueryHelpButton`) sits next to BOTH boxes you can type a query into — the `QueryBar` input and
the view editor's textarea — and every row in it is also the insert button (`appendQualifier`,
`utils/searchQuery.ts`, tested). In the query bar an insert edits the DRAFT only, so it still
commits on Enter like anything typed by hand.

It is deliberately NOT the whole GitHub grammar: the four groups are the qualifiers a review
queue actually uses, and the footer link owns the long tail. The view editor adds the other half
of the answer — `hasScopeQualifier` warns while a query carries no repo/org/person qualifier,
because the starter query would otherwise search all of GitHub and the first save would be a
surprise.

## Queue stats drawer (`components/queue/StatsDrawer.tsx` + `charts.tsx`)

A breakdown of the ACTIVE VIEW, toggled from the header (`s`), where every mark is also a
filter. Snapshot only — the queue payload is the currently-open PRs, so these are
distributions, never trends. Real trends would need a queue journal on disk; that's a
separate feature, not a tweak to this one.

**It describes the PAGE, not the view.** The queue fetches ONE page (`first: 50`) while the
tab badge shows GitHub's `issueCount` — so a 521-match view yields 50 rows. The table has
always been a top-50 list and that's fine; a _breakdown_ is not, because it reads as a claim
about the whole view. `StatsDrawer` takes `matching` (the view's issueCount) and, when it
exceeds the loaded rows, says so above the charts. Never drop that caveat.

- **All logic is pure and tested** (`utils/queueStats.ts`): idle/size/checks/review bucketing,
  top-6 nominal folding, and facet parse/format/match. The components only lay it out.
- **TWO BANDS, one wrapping rule each** — strips (a proportional bar plus a legend, so they need
  width) go two-up; distributions (short bar lists, all the same shape) go four-up. Nothing spans
  columns. The earlier single 4-column grid with `sm:col-span-2` cards made a card full-width at
  one breakpoint and half-width at the next, and the reflow read as arbitrary. Don't reintroduce
  a span.
- **A nominal card with ONE distinct value is not rendered**: a repo-scoped view's "by repo"
  would be a single 100% bar offering a filter that selects everything. Ordinal cards always
  render — an empty bucket is information, which is why they keep their zero rows.
- The trend card only appears once there are two days to join: the drawer caps at 60vh, and a
  card that says "not enough history yet" is a promise, not a chart.
- **The facet is URL state** (`?by=author:alice`) for the same reasons the view is. A facet
  implies an OPEN drawer (`QueueView.statsShown`) — closing the drawer or hitting `s` clears
  it, `esc` clears the facet alone. Switching views drops it (`useViewActions.select`), but a
  round trip into a PR does NOT: `uiStore.setRoute` mirrors every queue route's facet into
  `lastFacet` (the one funnel navigate/popstate/initial-resolve all pass through) and
  `navigateToQueue()` restores it, so "← Queue" lands back on the filtered queue.
  Session-only, unlike `lastViewId` — a cold launch starts unfiltered.
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
- **Pulse wears the same reserved STATUS tokens** as checks and review (you=warning,
  rotting=error, ready=success, them/moving=muted + `--tandem-bar`) — it is the same JOB, a small
  closed set of states each shipped with a written label, so it must not invent a palette.
- **Icons are lucide, never emoji** (`components/queue/pulseIcons.ts`): an emoji renders
  differently per machine, sits on its own baseline and cannot take a theme color, which would
  break the rule that the color IS the status token. `shared/xbar.ts` keeps a glyph table because
  a menu-bar plugin is plain text and has no other option — that is the ONLY exception.

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
- **A team is referenced, never inlined**: views carry `teamId` and the `{team}` token, so one
  team change updates every view at once, and a view's query keeps saying what it does.
- **Teams shard rather than paging**: `first: 50` is measured and stays; coverage comes from more
  parallel searches, which is the divergence the queue already made for views.
- **The pulse feed is a READ.** `/api/pulse` cannot write to GitHub and invokes no model.
- **No cohort digest** (user decision 2026-08-27): a model pass over a whole queue view was built
  and removed — it was slow enough that nobody waited for it, and the pulse counts already answer
  what it summarised. Don't rebuild it without a faster shape.
- **Import / export ships views AND teams together** (Settings › Views): a view carries a `teamId`, not a list of
  logins, so shipping one without its team hands the reader a view that refuses to search. A bare
  array still imports as views-only (old exports live in notes and chat threads), and `teams:
null` from that path means "leave the configured teams alone" — an empty array is a real
  instruction to clear them.
- **Settings is a RAIL of eight sections, and the section is URL state** (`/settings/<section>`,
  2026-08-28): four groups — Connection (GitHub PAT + claude CLI), Queue (teams, views, pulse),
  Agent (review policy, profiles, auto-approve), App (about). The seam is Queue vs Agent: pulse
  invokes no model and spends nothing, while auto-approve is the only page that can write to
  GitHub — which is why it is its own destination rather than a fourth card under the agent's
  switches. Back lives in the app header (`SettingsBreadcrumb`), exactly where the PR screen
  puts it; the body never grows a second breadcrumb. Every field saves on commit — there is no
  page-level Save, which is what makes navigating between eight sections safe. Content is
  centred at `max-w-6xl` with fields keeping their own caps (`fields.tsx`).
- **One vocabulary for the whole settings screen** (`components/settings/fields.tsx`):
  `SectionHeading` · `Panel` (title + hint + `aside`) · `FieldGrid` · `ToggleRow` ·
  `Number/Text/PromptField` · `SelectField` · `Note` · `EmptyState` · `FormActions`. Dropdowns
  are apollo's `Select`, never a native `<select>` — the platform control paints its popup from
  the OS, so it was the one field that ignored the app's theme, its type scale and dark mode; its
  trigger defaults to `h-9`, and every field here is `h-8`. Nothing floats between panels — a
  loose paragraph on the page background has no owner, so explanations are `Note`s INSIDE the
  panel they explain. Buttons obey four rules, written at the top of that file:
  panel-scoped actions live in the panel's `aside` at `size="xs"` (primary=default,
  secondary=outline, destructive=ghost+`text-destructive`+Trash2); a form's submit sits
  bottom-left at `size="xs"`, with a destructive action on what that form edits at the far
  right of the same row; row-level actions are `size="2xs" variant="ghost"`; labels are
  sentence case. `CredentialsForm` takes `size="xs"` so the setup screen keeps its roomier
  first-run buttons while Settings matches everything around it.
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

## Cross-platform (macOS · Windows · Linux)

The dev loop and the server run on all three; only the packaging and the
menu-bar plugin are macOS-shaped. Four rules keep it that way — each one is a
thing that was actually broken.

- **Never let a native path separator become a string the app reads back.**
  The asset manifest puts `relative()` output into BOTH an import specifier and
  a URL key, so it POSIX-normalizes — on Windows `'../../dist/assets\index.js'`
  is a JS literal whose `\i` is a bare `i`, and 300-odd imports silently point
  at nothing while the build stays green. That logic lives in
  `scripts/asset-manifest.ts` (TESTED) rather than in the generator beside its
  I/O, which is the only reason CI can execute it. Any generator that
  interpolates a path owes the same normalization.
- **The claude CLI is resolved, not named** (`claudeBin()` in `agent/claude.ts`):
  on Windows it is an npm shim (`claude.cmd`), which CreateProcess cannot run
  from a bare `"claude"` argv[0]. `Bun.which` applies PATHEXT and Bun's spawn
  routes a `.cmd` through cmd.exe with its own escaping — which is why we hand
  it a path and never build a `cmd /c` line ourselves. That would re-parse our
  arguments and undo the discrete-argv rule that keeps model names uninjectable.
- **`rename` over an open file is not atomic on Windows.** `jsonFile.ts` retries
  EPERM/EACCES/EBUSY ten times at 20ms, win32 only — two servers can share one
  `$TANDEM_HOME`, so a reader mid-read is a real collision, not a theoretical
  one. POSIX takes the first branch and never sleeps.
- **`chmod` is a no-op on Windows**, so 0600 is a promise the platform doesn't
  keep. `/api/config/status` reports `posixFileModes` and Settings › About says
  which of the two is true. Don't restore the flat "0600" claim anywhere.

`server/platform.ts` (`IS_WINDOWS` / `IS_DARWIN`) is where the OS is NAMED, the
way `runtime.ts` names the compiled-binary check; the behavior stays at each
call site, because each asks a different question. The client half is
`keyboard/platform.ts` and cannot share code with it — one reads `process`, the
other `navigator`.

Two things stay macOS-only, both because the HOST is: the `.app` bundle
(`sips`/`iconutil`/`codesign` — `build-app.ts` falls through to a bare
`tandem.exe`/`tandem` elsewhere), and the xbar / SwiftBar plugin, which has no
Windows equivalent to port to. `/api/pulse.xbar` itself is plain text over HTTP
and answers any client. The native window needs a host webview — WKWebView,
WebView2, WebKitGTK; `app.ts` imports `webview-bun` DYNAMICALLY so a missing one
prints the install link and points at `pnpm serve` instead of dying in `dlopen`.
`SizeHint` can't ride along on that import (a `const enum` has no runtime
binding), hence the inlined `SIZE_HINT_NONE`.

Modifier keys: every dispatcher already accepts `metaKey || ctrlKey`; only the
LABEL is per-platform (`keyboard/platform.ts` → `MOD`, `ALT`, `IS_MAC`). The
native quit bridge in `app.ts` is the one binding that must pick a side, and it
picks by `process.platform` at init-script build time.

## Pitfalls

- **A new `/api/*` family 404s in dev**: the Vite proxy forwards ALL of `/api` — but the Bun server
  must be RESTARTED to pick up new routes (no HMR server-side).
- **A shell one-liner in `package.json` is a Windows break.** `clean` is
  `bun scripts/clean.ts`, not `rm -rf`; cmd.exe and PowerShell have neither.
- **CI's `[ubuntu-latest, windows-latest]` matrix runs, it does not prove.** It
  executes the path-separator rule (via `scripts/asset-manifest.test.ts`) and
  type-checks the rest; the rename retry and the CLI shim resolution have no
  test driving them, so a regression there ships green. `ci.yml` says so.
- **`.gitattributes` pins `eol=lf`.** Without it git's Windows default checks the
  tree out as CRLF and prettier (no config here, so `endOfLine: "lf"`) reports
  every file as dirty.
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
- **A description image or demo video renders as a broken box**: something bypassed the attachment
  proxy. Either the response was fetched without `bodyHTML` (nothing to resolve against, so the
  markdown is left untouched by design) or a `<video>` lost its tag to the sanitizer. Never "fix"
  it by pointing the markup back at `github.com/user-attachments` — that URL cannot load from here.
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
- **A Radix `Select` refuses an empty item value.** `""` is how Radix spells "nothing is
  selected", so a real option meaning "no filter" (Pulse's "All views, merged", the view editor's
  "None") throws if handed `value=""`. Both call sites swap in a sentinel at the boundary and map
  it back on change, so `""` is still what the caller passes and what reaches disk — check
  `settings.json`/`views.json` for a leaked `__empty__`/`__none__` if one is ever added by hand.
- **A dialog ignores its `max-w-`**: apollo's `DialogContent` carries `sm:max-w-lg`, and a
  responsive variant beats a plain utility however tailwind-merge orders them — so a widening
  class MUST be written `sm:max-w-3xl`, plus a `w-[min(48rem,92vw)]` to re-cap a viewport that is
  past the `sm` breakpoint but narrower than the max. `AlertDialogContent` is the exception: its
  default is a bare `max-w-lg`, so a plain override works there. A bare `max-w-xl` on the
  shortcuts sheet was inert for its whole life.
- **A chat chip refuses to apply**: the finding moved state since the answer (staged, dismissed,
  rerun) — the message lands on the chip, that's the re-validation working, not a bug.
- **A team-backed view says "no members" instead of returning everything**: that is
  `shardTeamQuery` refusing an empty expansion, not a bug. Attach a team or drop the token.
- **`blocked on you` is always 0**: no login resolved (`/api/config/status` probe failed, or the
  token is bad). Pulse degrades to attributing nothing to you rather than guessing — check the
  drawer's pulse card, which says so out loud.
- **A team review request never reads as yours.** GitHub does not return team membership on a
  search node, so `awaitsViewer` matches direct user requests only.
- **The sparkline is empty for a day**: the rollup is written from the queue POLL, so it needs the
  app open at least once that day, and `settings.pulse.journalEnabled` on.
- **`/api/pulse.xbar` 404s after an upgrade**: same pitfall as any new `/api/*` family — the Bun
  server has to be RESTARTED to pick up new routes.
- **`ChatPanel` must stay mounted KEYED BY SCOPE**: the remount is what clears the composer draft
  and the streaming buffer. Resetting them in an effect is exactly what the React Compiler lint
  rejects (`react-hooks/set-state-in-effect`).
- **Chat's fence gate only hides `json**: a reply whose LAST fence is a bare ` block streams
  visibly and is then peeled off at turn-end — the persisted text is always the authoritative one.
