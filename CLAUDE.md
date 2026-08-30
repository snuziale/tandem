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
  /api/queue/checks  github/checks.ts    the per-check refinement a search can't carry (below)
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

Ask the agent about the PR, about ONE finding, or about the LINES YOU ARE POINTING AT: why it
flagged something, whether it still believes it, how to reword the comment, or "write this comment
for me". Interactive, but the same read-only pass as the pipeline (`--safe-mode --tools ''`), and it
changes nothing on its own.

**It is the review's second cursor, and three things follow from that.** It SEES where you are (the
pane's one line selection rides on the turn), it MOVES you (a `path.ts:42` in its prose is a
control), and it WRITES INTO YOUR DRAFT (`stage-comment`). None of that touches invariant §1: every
one is still a proposal the human applies.

- **The answering PROFILE follows the run, and the SERVER reads it.** `startChatTurn` resolves it
  as `opts.agentId ?? (await getRun(prId, headSha))?.agentId`, so asking "why did you flag this?"
  of an architecture run reaches the architecture reviewer — without the client shipping back a
  fact the run record already holds (the pane's copy comes from a 30s poll). The wire field stays
  as an override for an "ask another lens" affordance that does not exist yet. Scope is unchanged:
  the conversation is still keyed by (PR, sha, finding), so a rerun under another profile does not
  fork it.
- **Scope is the identity. The ANCHOR is attention, and they are not the same thing.**
  `chatKeyOf(prId, headSha[, findingId])` is the session id, the storage key, and the URL segment —
  so opening a finding's thread is a plain GET with no create call, and a new head sha is a new
  conversation. Where the reviewer is POINTING (`ChatAnchor`) rides on the TURN instead, is
  persisted on the user message, and never touches the key: keying a conversation by the selection
  would fork the thread on every drag. The pane's focused finding IS the scope (`ChatPanel` is
  mounted keyed by it).
- **The anchor comes from `paneAnchorOf` (`components/pr/annotations.ts`, TESTED), the ONE spelling
  of the pane's selection-precedence table, resolved ONCE by `PrDetailView` and handed to both
  readers** — `DiffPane` paints it, chat asks about it. Calling it in both places meant two
  seven-argument call sites agreeing by luck, and they had already drifted. — composer, then find-in-diff hit, then focused staged
  comment or human thread, then focused finding. `DiffPane` paints it and chat asks about it, so
  "where the reviewer is pointing" is one function with two readers rather than two implementations
  agreeing by luck. The header's anchor chip is `--tandem-bar`, NOT violet: pointing at lines is
  the most human thing in the panel, and violet means machine-authored (§3).
- **Stateless multi-turn, not CLI session resume.** Each turn rebuilds
  `[stable prefix] + [everything that moves] + [question]` (`chat/prompt.ts`). **ORDER IS THE
  CACHE**: mission, action contract, PR header, conventions and THE DIFF are the prefix; the
  fetched files, findings, threads, draft, review progress, anchor and transcript all sit below it.
  `findingsBlock` and `draftBlock` used to sit ABOVE the diff, which put a block that changes on
  every apply in front of 60,000 stable characters — staging one comment re-paid for the whole diff
  on every turn after. `budgetedDiffBlock` orders by the run's PATHS only, never by finding state,
  for the same reason. Transcripts live in `chats.json`; `--no-session-persistence` stays.
- **The prompt knows how far through the review the human is** (`reviewProgressBlock`): viewed
  n/m, which files are still unopened, comments staged, verdict. It is free — the draft is already
  loaded — and it is what lets an answer say "the one file you have not opened is where the blocker
  is" instead of describing a PR the reviewer has mostly read.
- **Prose first, actions in an OPTIONAL trailing ``json fence** (`chat/prose.ts`): strict JSON is
not the product here, so an unparseable tail degrades to prose-only instead of failing the turn.
`createFenceGate` hides the fence while it streams (only ``json — a ```ts snippet still
  streams); `splitTrailingJson` walks fences line by line and is authoritative for what persists.
- **Actions are PROPOSALS, gated twice** (`chat/actions.ts`): `sanitizeChatActions` before the chip
  is shown (ids exist, transitions legal, `new-finding` anchored via `diffLineIndex` and dropped
  where a human already commented — the pass-2 gate), then re-validated on click, because the
  finding may have been staged or dismissed since. Kinds: revise-finding (proposed/edited only —
  a STAGED finding's text belongs to the draft, so that's `revise-comment` on its localId),
  dismiss-finding, new-finding, revise-comment, **stage-comment**. Apply is human-triggered only;
  invariant §1 holds.
- **`stage-comment` is the only kind that needs NO RUN, and that is the point.** Every other kind
  edits something a run emitted, so a PR without one could produce nothing at all — and runs are
  opt-in (§2), so "no run" is the DEFAULT path. It writes a `PendingComment` straight into the
  draft at lines the model names, anchored and clamped through `clampCommentRange` exactly like a
  dragged selection, so a proposal reaching past a hunk edge stops there instead of dying with a
  per-comment 422 at submit. Unlike a finding it is NOT dropped where a human already commented:
  a finding is the agent volunteering, and this is the reviewer having asked.
- **A suggestion is previewed as a DIFF, and the left side is computed server-side.**
  `replaces` (on stage-comment, revise-finding and new-finding) is `patchLineText` over the same
  patch the action was anchored against, attached at sanitize time — the chip has no patch anywhere
  near it, and a preview drawn from anything else would be a different claim than the one being
  applied. The chip's rail and label stay violet; the added and removed lines take the DIFF's own
  red and green. Violet marks provenance and must never tint content.
- **Apply-all is SEQUENTIAL** (`useChat.applyAll`): `stage-comment` reads the draft, pushes a
  comment and writes it back, so two applies in flight would both read before either wrote and one
  comment would vanish. Each still re-validates server-side, so a stale proposal fails on its own
  chip without stopping the rest.
- **`needContext` is a SERVER hop, not a tool.** The turn may ask for files it cannot see; the
  server fetches them read-only at the PR's head sha (`chat/context.ts`, ≤2 hops, owner/repo from
  the session, never from the model) and re-asks. No write tool exists at any point. A hop is
  EXPENSIVE — it is a whole extra model call — which is why `@path` mentions are pre-loaded before
  hop 0 instead (`contextPaths` on the turn, fetched CONCURRENTLY), and why a pre-load emits no
  `context` frame: that frame means "I threw away the answer I was writing", and a pre-load did
  neither. **A mentioned file already in the diff is NOT skipped**: the diff carries HUNKS, so
  naming a file is how the reviewer asks for the whole thing. Filtering those out made the client's
  resolution (against the diff's own paths) and the server's filter exact complements, so nothing
  was ever fetched — the feature was dead. A full path the diff does not contain passes through
  unresolved for the server to try; a bare word never does.
- **A hop must not delete what you were reading.** `useChat` moves the prose written before a hop
  into a `ChatHop` record rendered dimmed under "asked for X · re-reading". It used to
  `setStreaming("")` and the text simply vanished mid-turn, which is exactly the class of thing
  that makes a panel feel unreliable.
- Turns are server-owned (`live.ts`, `kind: "chat"` so they stay out of the run accounting) and
  stream real token deltas (`--include-partial-messages`, chat only). Chat spends from the SAME
  daily ceiling as runs.
- **The run summary is TURN ZERO, not a block above the findings.** Pass 3 already wrote it and it
  is already paid for; rendering it as the conversation's first message is what makes the pane read
  as a conversation that opens with the report rather than a report with a chat drawer bolted
  underneath. It lives on the RUN, so it is never persisted into the transcript and never doubles.
- **Openers are DERIVED, never asked** (`components/agent/chatOpeners.ts`, TESTED). An empty
  conversation shows up to four chips computed from the run record and the draft — blockers, the
  score gap, "what did you not flag", a read-back of your staged comments, the biggest file you
  have not opened. Nothing spends a token until one is clicked, which is what keeps §2 intact; an
  opener that pre-asked would be exactly the automatic spend that rule exists to prevent.
- **`/command` and `@path` are CLIENT-side and pure** (`components/agent/chatCommands.ts`, TESTED):
  a slash command expands into an ordinary question BEFORE it is sent, so the transcript stays
  prose forever after and the server's turn contract never grows a command vocabulary to keep in
  step with the UI. An unrecognized `/whatever` is left completely alone. An `@path` stays in the
  text (it is part of what was asked) and is ALSO reported as `contextPaths`; bare names resolve
  through the same `resolveCodeRef` the agent's own citations do, so an ambiguous one resolves to
  nothing rather than to the wrong file.
- **A `path.ts:42` in agent prose is a CONTROL** (`components/common/codeRefs.ts` TESTED +
  `mdCodeRefs.ts`): it scrolls the diff, expands the file and MARKS the lines it named
  (`uiStore.revealedAnchor`, second in the precedence table). Scrolling alone lands the reader in
  the right neighbourhood with nothing saying which lines were meant — the mark is the difference
  between "somewhere near here" and "these lines". A range (`patch.ts:40-52`) marks the whole span
  and scrolls to its TOP, since the anchor is the end. Because the chat's own anchor chip reads the
  SAME `paneAnchorOf`, a follow-up question is then already scoped to the lines you jumped to.
  **A citation outside the patch degrades to revealing the FILE**: the agent cites lines it has
  READ, which is not the set the diff SHOWS (it sees whole files through `@path` and
  `needContext`), so an unchecked click had nothing to scroll to and nothing to mark — a dead link
  indistinguishable from a slow one. Same fallback a prior run's finding gets. It
  applies nothing and mutates nothing, so it needs no chip and no gate. The rehype plugin runs
  AFTER `rehype-sanitize` — what it adds is ours, not the document's — and skips `pre` subtrees,
  because a code block is a quotation and peppering it with buttons would make the quotation lie.
  **Opt-in via `Markdown`'s `onRefClick`**, so a PR description or a thread comment renders exactly
  as it always did.

## The pane before a run exists (`components/agent/PreflightCard.tsx`)

Landing on a PR with no run at this commit is the FIRST thing most reviewers
see, and it used to be a lone "Run agent" button: a spend commitment with
nothing to weigh it against. Everything the decision turns on was already in
memory. The card is the rule made concrete — **never ask for a decision without
handing over what the decision turns on.**

- **The skip is PREDICTED, not discovered** (`preflightOf` → `skipDecision`), and it is fed the
  SERVER's inputs: `pr.changedFiles` and `countDiffLines`, exactly what `pipeline/run.ts` passes.
  Not `files.length` — the files endpoint caps its list (`FILES_API_WINDOW`), so on the very PRs
  the file cap exists for the two diverge and the card would offer a run the pipeline then refuses.
  Sharing the rule without sharing its inputs buys the guarantee's appearance, not the guarantee.
  A manual run applies `skipDecision` too — `force` only bypasses the sha
  cache — so a draft PR would spend a fetch to produce a Skipped record. The
  card says "would be skipped · draft" and renders NO BUTTON, plus the one
  sentence that fixes it. This is why `decide.ts` moved to
  `shared/agent-decide.ts`: a second copy of those rules on the client would be
  a promise the server had no reason to keep. `agentEnabledFor` moved to
  `shared/settings-types.ts` for exactly the same reason.
- **The shape of the run is stated in PASSES, never seconds** (`clusterFiles`,
  now `shared/agent-cluster.ts`): the cluster count is knowable and a duration
  is a guess, and a guessed ETA that runs long is worse than no ETA. Beside it,
  spend today against the ceiling — both halves in dollars, which is why it does
  not go through `formatSpend` (that falls back to a token count at $0, and
  "0k tok of $5.00" is not a sentence).
- **The review that already happened is the reason the card exists**
  (`priorReviewFor`, TESTED). Staleness keeps old runs and their findings rather
  than deleting them (spec §2) — and nothing ever showed them, because
  `runFor` can only answer for the sha you already named. `useAgentRuns` now
  also exposes `all`, and the card surfaces the most recent finished run on any
  OTHER sha of this PR: its summary, score, severity tally, and the honest
  headline **"N of M still point at files this commit changes"**. Only `ready`
  and `stale` runs qualify — a failed or skipped one has nothing to tell you —
  and dismissed/posted findings are excluded, because a human already settled
  those.
- **A prior finding reveals its FILE, never its line.** It was anchored against
  a different commit, so the line number is the one thing about it that has
  certainly moved.

## Conversation history (`components/agent/PriorThreads.tsx`)

`GET /api/chats?prId=` has always listed every thread on a PR and nothing ever
called it: the pane could only open the ONE session matching its current scope,
so each new commit read as amnesia. `useChatSessions` is that list, and it
appears in the chat panel only while THIS conversation is empty — once you are
talking, older threads are not what the pane is for.

- **One renderer, `ChatMessageView`.** The live pane and the read-back draw the same `ChatMessage`;
  two copies of that JSX drifted before either shipped (the replay dropped `contextRead` and printed
  a raw `stage-comment` where the pane said "comment on your draft"). Interactivity is the only real
  difference, so it is the only prop: no `handlers` = inert chips.
- **The list is GATED on the conversation being empty** (`useChatSessions(prId, enabled)`), which is
  also the only time it renders. Every session in that response carries its whole transcript, so
  ungated it fetched on every PR open and again after every completed turn — when the panel is
  guaranteed not to show it.
- **Read-only, always.** A thread at another sha was about code that has since
  moved, so continuing it in place would attach new answers to a diff neither
  party was looking at — and its action chips were validated against a run that
  is gone, so they are LISTED rather than clickable. Reading it back is the
  whole ask; re-asking is a fresh question at this commit.
- A thread is named by its finding's own TITLE where the current run can still
  resolve the id ("one finding" tells you nothing about which).
- The list is invalidated on `turn-end` and on clear — it is keyed
  `["chats", prId]`, which does NOT collide with a session's own
  `["chat", id]`.

## The review flow (the human half)

- The draft (`PendingReview`) lives SERVER-SIDE in `~/.tandem/reviews.json`, keyed by prId —
  browser and native app agree; optimistic updates via `usePendingReview`.
- **Provenance is `isAgentAuthored`, not `findingId`** (`shared/review-types.ts`, TESTED). A
  comment the agent drafted in CHAT has no finding behind it, so reading `findingId` alone made the
  tray count it as the reviewer's and the inline card label it "your comment · staged" in the
  human colour — violet means machine-authored (§3), and that was the claim being made wrong.
  `stage-comment` sets `agentDrafted`; both surfaces read the one predicate.
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
  **viewed is a CHECKBOX per file, there** — the pane toolbar keeps only the `viewed n/m` tally, which
  wears a small meter beside the count (`ViewedMeter`) — `--tandem-bar`, NOT violet (that is
  machine-authored, and this is the reviewer's own progress) and NOT a status token going green
  at 100% (those belong to checks/review/pulse; a full bar already says done). Fixed width, so
  the toolbar holds still as the count climbs.
  It is drawn as a TITLE BAR (`bg-muted`, `border-y`), not a bare row, because the library's
  in-diff "N unmodified lines" expander wears the same chevron at the same left edge — on a flat
  background the two sat at one visual depth and nothing said which owned the file and which
  owned a gap inside it. The bar's dead space toggles VIEWED (mouse-only: `aria-hidden` +
  `tabIndex={-1}`, so the checkbox stays the ONE labelled control) — clicking a row to tick its
  own checkbox is the ordinary pattern, and it folds as a consequence. The chevron beside it
  stays a PURE fold and the two must NOT be merged into one state: `viewed` is a review CLAIM
  that persists in the draft, counts in `viewed n/m` and ships with the submitted review, so
  peeking back into a file you already ticked must not silently un-tick it, and folding a
  generated file out of the way must not claim you read it. The bar must stay fully
  opaque — it is sticky, so an `opacity` on it lets the file's own code scroll through its
  title; that is why "viewed" dims an INNER wrapper instead.
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
- **`options.itemMetrics.diffHeaderHeight` MUST match our header's real height** (36px = `h-9`,
  borders included — they sit inside the box, so `border-y` costs nothing).
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

- **Find in diff searches the PATCHES, never the DOM** (`components/pr/diffSearch.ts`, TESTED +
  `DiffSearchBar`/`DiffSearchResults`, opened with `/` or `MOD+F`): the browser's own find is what
  this replaces, and it fails for a structural reason — CodeView is virtualized and a folded file
  (which is what marking one viewed does) has no code in the DOM at all. The patches are in
  memory for every file whatever is on screen, so the scan is pure, the count is honest, and
  `scrollTo` + the pane's line selection do the jumping — there is NO character-level highlight
  inside the code, because the only non-destructive way to paint one is the CSS Custom Highlight
  API re-applied through `onPostRender`, and the results list answers the same question without
  reaching into the library's shadow tree.
  - **It reads the patch the pane is CURRENTLY rendering, through the SAME call**:
    `keepLinesByPath` (`annotations.ts`, the one spelling of "what must not fold", shared with
    `DiffPane`'s own `keepByPath`) feeds `renderedPatch` (`shared/gh/patch.ts`, TESTED — raw
    patch, plus the hide-whitespace rewrite when `w` is on), which is what `DiffPane` builds its
    own items from. So "what is on screen" is one function, not two implementations agreeing by
    luck, and with `w` on a hit can never be a line the reader cannot see. The results list says
    so out loud, next to the truncation notice — both are why a count here can be lower than
    github.com's.
  - **Expanded context is NOT searched.** It came from the blob, so the patch never named it —
    the same reason a comment cannot be staged there.
  - **Typing does not jump.** It scrolls the pane and force-expands a file to land a hit, and
    doing that per keystroke moves the reader's place while they are still deciding; the count
    and the list answer "is it in here?" instantly, `↵`/`n` commit to going there.
  - The hit borrows the pane's ONE line selection, third in the precedence table (after the
    composer and a clicked citation), and jumping clears every other claim — two borders would be
    two claims about one selection.

The FILE TREE is `@pierre/trees` (`components/pr/FileTree.tsx`): `useFileTree` constructs the
model ONCE — later state reaches rows through model methods, so `renderRowDecoration` reads a
ref (`stateRef`) and a `setGitStatus(freshArray)` call after viewed/agent changes re-renders the
visible rows. Git-status badges come from the PR's change types; decorations carry `+a −d`,
viewed ✓, and the violet agent dot. External selection follows the `selectedPath` prop
(select + scrollToPath) — and selection is SINGLE: `item.select()` is additive, so both the
external-selection effect and `onSelectionChange` deselect everything else. One file is open in
the diff, so more than one highlighted row is a lie. The tree owns only the keys it
CONSUMES (arrows, Home/End, Enter, Space, Esc, F2) — the detail key handler bails on THOSE while
focus is inside `[data-tandem-filetree]`, and on nothing else. It used to bail on every key there,
so clicking a file silently killed the whole detail keymap until you clicked away. Letters are
safe to take: a-z type-ahead is gated on `searchEnabled` and this tree passes `search: false`, so
it never sees one; its search box is an `<input>`, which `isTypingTarget` already covers.

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
    team-types.ts  pulse.ts (TESTED: states, blockedOn, grouping, reviewVerdictOf)
    checks.ts (TESTED: what may be SAID about a PR's CI — dedupe to the latest
                     attempt per name, the headline's word/count rules, and
                     applyChecks folding the refinement into a queue row)
    agent-decide.ts (TESTED: skipDecision) · agent-cluster.ts (TESTED: the
                     pass-2 grouping) — SHARED because the PR pane's pre-flight
                     card answers "would this even run, and how big is it"
                     before the reviewer spends one
    agent-activity.ts (TESTED: live-registry ↔ run-record reconciliation, today's tally)
    pulse-journal.ts (TESTED)  xbar.ts (TESTED: the menu-bar plugin renderer)
                     kebab-case here; gh/ below is a camelCase sub-package. `-schema` means
                     zod (chat-schema, finding-schema); plain data is named for what it holds.
    gh/              runtime-neutral GitHub core, ALL TESTED: wire.ts (raw shapes),
                     attachments.ts (the uuid↔signed-URL join + markdown rewrite),
                     normalize.ts, queueQuery.ts, detailQuery.ts, patch.ts (buildFilePatch,
                     splitRawDiff, diffLineIndex, clampCommentRange, patchLineText),
                     generated.ts, prKey.ts (prId = "owner/repo#n"),
                     team.ts ({team} expansion + sharding),
                     checksQuery.ts (the deferred per-PR checks batch)
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
             pipeline/{run,prompts,parse,context}  (cluster + decide live in
             shared/ — the pane predicts skips and pass counts before you spend)
             chat/{turn,prompt,prose,actions,context,store,routes}
  api/               plain-fetch clients (http.ts wrapper + one file per resource, named for
                     the resource: config, settings, queue, prs, reviews, runs, seen, views,
                     teams, pulse)
  hooks/             useQueue (60s poll + focus refetch)  useQueueChecks (the
                     checks refinement, keyed by the rows' own prId@headSha)  usePrDetail/usePrFiles (files:
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
  components/        common/codeRefs.ts (TESTED: file:line in prose) + mdCodeRefs.ts (the
                     rehype walk that makes them controls)
                     agent/chatOpeners.ts + chatCommands.ts (both TESTED, both PURE — the
                     conversation's free half: what to ask, and / and @)
                     layout/AppHeader (the ONE header: chrome + brand + agent strip + settings
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
seen.json      per prId at last open: head sha, comment + thread counts, updatedAt
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
  o, `/` and `MOD+F` find-in-diff, n/N match). `MOD+F` is handled AHEAD of the modifier bail and
  preventDefaults — the browser's find is exactly what does not work in a virtualized diff — same snapshot pattern via a ref updated in an effect. **`esc` closes the composer and
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

- **The React Compiler is load-bearing, and the BUILD is what enforces it** (2026-08-28): four
  shapes make it skip a WHOLE component, silently — an eslint suppression of any `react-hooks`
  rule; a `try` with no `catch`; an optional chain inside a `try`; and a default in a destructured
  props parameter (`{ cols = 2 }`). Write `{ cols }` with `const columns = cols ?? 2` in the body,
  keep `PrDetailView` suppression-free, and put a `try` that needs a bare `finally` in a
  module-level function (the compiler only compiles components and hooks, so down there it is
  free — that is why `FileTree`'s `selectOnly` is where it is). Lint CANNOT back this up:
  `eslint-plugin-react-hooks` bundles its own, NEWER compiler copy and stays quiet for three of
  the four, so `vite.config.ts` sets `panicThreshold: "all_errors"` and `ci.yml` runs `pnpm build`.
  Never lower that threshold to quiet a build — rewrite the code the message points at.
- **Typed server endpoints, not a GitHub passthrough proxy**: prewarm/pipeline need server-side
  normalized access, and "exactly two writes" stays auditable.
- **Parallel per-view queue searches** (spec divergence, documented above).
- **The selected queue view is URL state** (`/?view=<id>`), never component state: tab switches
  are history entries, a view is linkable, and back-from-detail lands where you left. One place
  reconciles URL ↔ saved list (`useActiveView`, canonicalizing with a history REPLACE);
  `uiStore.lastViewId` is only a persisted memory for cold launches and "← Queue".
- **One header component** (`layout/AppHeader`) owns the chrome for every screen — a screen
  passes slots, never its own `<header>`.
- **The agent pane has THREE modes, not a chat toggle** (`uiStore.prAgentMode`: `findings` /
  `split` / `chat`, persisted; the ToggleGroup in the pane header, or `⇧C`): the conversation
  outgrew a drawer capped at half the pane. In `chat` the findings fold to a one-row tally that is
  also the way back — nothing is hidden, and an in-flight run still says so there, because that row
  is the only one left. `c` stays "chat about the focused finding" and only ever GROWS the
  conversation's share: a key that sometimes put the cursor in the box and sometimes resized the
  pane would be neither.
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
- **The PR screen hitches on a large PR** (folding, marking viewed, opening a composer): a
  component bailed out of the **React Compiler**. `pnpm build` now fails when one does
  (`panicThreshold: "all_errors"`), so this should only ever be seen mid-edit in `pnpm dev` — the
  build message names the file and the shape. It matters because the compiler is the ONLY
  memoization these components have: `PrDetailView` feeds `DiffPane`
  `triageFindings`/`agentPaths`/`collapsedPaths`, and unmemoized those are fresh identities every
  render, so `annotationsByPath` and `items` rebuild and a full `setItems` goes through CodeView —
  and with hide-whitespace ON, `keepByPath` changes too, so EVERY file is re-`hideWhitespaceChanges`'d,
  re-`parsePatchFiles`'d and re-indexed, which also throws away `fileDiff` identity and every
  expanded region.
- **A value the compiler cannot memoize poisons everything downstream.** It refuses any closure
  capturing a binding declared LATER in the component, and that is silent — no bail, no message,
  the function is just emitted raw. `scrollToTwice` sat below `selectFile`, so `selectFile`,
  `focusFinding` and the key handler all missed, and two of them are dependencies of the main JSX
  memo block — which re-rendered `FileTree`, `DiffPane` and `AgentPane` on every render for free.
  Declare helpers ABOVE their callers.

- **CodeView doesn't scroll / scrollTo dead**: container lost `overflow-y-auto` or bounded height.
- **Annotations don't move/appear**: item `version` didn't change — check `versionOf` inputs.
- **GraphQL 502s**: that's GitHub's ~10s budget. Never batch searches; keep the single retry.
- **Don't raise the queue page size.** MEASURED 2026-08-23: a 521-match `review-requested:@me`
  search already runs 6.5-6.8s at `first: 50`, and 504/502s start at 60. Raising `first` is what
  does not work — the same search at 100 took 7.5-9.3s even stripped of check contexts and
  threads. More coverage needs a different mechanism (cursor paging on demand), not a bigger
  `first`.
  **Node fields are a different story, and the 2026-08-23 note that trimming them "doesn't buy it
  back" was over-generalised from a repo with few checks.** MEASURED 2026-08-29 on the real built
  query over `repo:UiPath/flow-workbench` (50 rows, 20-86 check contexts each), three runs each:
  with `contexts(first: 20) { nodes }` 6.3-7.3s / 243KB; with `contexts { totalCount }` and no
  nodes 4.3-4.6s / 49KB. The check contexts were a third of the queue's latency. They are gone
  from the queue query — see below.
- **The queue's checks arrive in a SECOND request, and that is what makes the row and the PR page
  agree** (`shared/gh/checksQuery.ts` TESTED + `server/github/checks.ts` + `useQueueChecks`).
  Per-check nodes are unaffordable inside a `search` (above) but cheap through
  `repository.pullRequest` — MEASURED 2026-08-29: 10 PRs 1.2s, 25 PRs 2.4s, because the cost was
  never the check runs, it was materializing them across a search result set. So the table paints
  from the rollup and sharpens a couple of seconds later, in parallel chunks of 25 under a
  fan-out cap, a failed chunk leaving those rows exactly as they were.
  **The refinement is folded in at `QueueView`, not in the table**, so ONE set of rows feeds the
  table, the stats drawer, the pulse pill and the facets. `applyChecks` (`shared/checks.ts`,
  TESTED) refuses a snapshot from another head sha — a queue poll and this request race — and
  re-derives `checkRollup` from the deduped runs, because pulse's `blockedOn` reads that field:
  "checks passing" beside "blocked on you · checks red" is the same contradiction one column over.
  A WINDOWED snapshot keeps GitHub's rollup instead, since a window cannot be deduped safely.
  The server's own pulse (xbar, the journal) has no refinement pass and still reads the raw
  rollup, so a menu-bar line can lag the app on a PR whose only red mark is a superseded attempt.
- **Check COUNTS come from the runs when they exist** (`shared/checks.ts`, TESTED). The queue
  SEARCH asks the rollup for `state` and `contexts { totalCount }` and NO nodes: they cost ~2.2s
  a poll, and a window of them cannot be counted honestly — 47 of 50 rows on a real view had more
  than the 20 contexts we fetched, so "18 passing" on a PR with 40 green checks was a count of the
  window. `checkHeadlineOf` is the one place that decides what may be said, and it phrases the
  SAME claim at two widths: `35/47 passing` in the column, "35 of 47 checks passing" in the chip.
  Before the refinement lands it prints the rollup's word beside the exact total
  (`not passing · 53`) — "not passing" is GitHub's own wording for a rollup whose cause we cannot
  see, and unlike "failing" it stays true when that cause is a cancellation. A windowed count
  renders as `n+`, never as a ratio.
- **Re-runs collapse: one row per check NAME, latest attempt wins** (`dedupeChecks`,
  `shared/checks.ts`, TESTED). A commit collects a run per workflow ATTEMPT, so #3468 carried 53
  contexts for 47 checks — `demo-exists` appeared as CANCELLED and then SUCCESS twice, ten seconds
  apart. Every raw count was therefore a count of attempts, and the superseded cancellation dragged
  the PR red. The name is the key because it is what branch protection matches a required check
  on; recency is `completedAt ?? startedAt` (a running re-run has no completion and is still the
  newer one), fetched by the DETAIL query only.
  **The deduped runs then OUTRANK GitHub's rollup** — deferring to it would undo the collapse,
  since the rollup keeps counting the attempt the re-run replaced. #3468 reads "35 of 47 checks
  passing" while GitHub still says failure, so `rollupDisagrees` puts one sentence in the popover
  saying why. The rollup is still in charge when there are no runs or the fetch is short of the
  total: a window cannot be deduped safely, because the later attempt may be outside it.
  **The QUEUE therefore cannot collapse anything and does not pretend to** — it has no nodes, so
  its cell shows the rollup's coarse word (`not passing · 53`), which is also what github.com's own
  PR LIST shows. MEASURED 2026-08-29: even the leanest useful nodes — name, status, conclusion,
  `completedAt` — cost 8.5-9.2s / 389KB against 4.3-4.6s / 49KB without them, i.e. straight into
  GitHub's ~10s 502 cliff. Detail is where a check gets named.
- **The popover is grouped, then alphabetical**: what is wrong (failure, cancelled, pending), then
  success, then what never ran (neutral, skipped) — with names sorted numerically inside each
  group, so a matrix's `[2/5]` precedes its `[10/5]`. Skipped jobs sat beside the failures before,
  and on a repo where a third of the matrix is conditional they pushed the runs that actually
  reported below the fold.
- **`cancelled` is not `failure`.** The normalizer used to fold CANCELLED in with TIMED_OUT and
  the rest, so a run superseded by a green re-run ten seconds later rendered as "1 failing" in red
  on a PR whose checks GitHub lists as cancelled. It is its own `CheckRun["status"]` with its own
  dot in the detail popover. The TONE does not change — GitHub's own rollup goes FAILURE for a
  cancelled run, so the row stays red; only the word was wrong.
- **`useQuery` detail-vs-queue thread counts differ**: queue fetches `reviewThreads(first:1)`
  totalCount only; `unresolvedThreadCount` is accurate only on detail. Same field with different
  args in one query is a GraphQL conflict — that's why detailQuery.ts doesn't reuse the fragment.
- **`reviewDecision` is null without branch protection, and `reviewVerdictOf` is the ONE reading
  of it** (`shared/pulse.ts`). GitHub only computes the repo-wide verdict when the BASE branch has
  a required-reviews rule; without one it stays null however many approvals a PR has. So three
  surfaces answer "where does this review stand" — the badge (`ReviewCell`), the drawer's
  `reviewBucket`, and pulse's `isApproved` — and they must not each re-derive it. They did: pulse
  fell back to `approvalCount` while the other two read the decision alone, so an approved PR on
  an unprotected branch said "ready to merge", "No review" and `✓1` on one row. All three now go
  through `reviewVerdictOf` (decision first; then counts, change-requests winning the tie, since
  an approving review stays in `approvals` after the same person later requests changes).
  `viewerLatestReview` still wins the BADGE ahead of all of it — your own verdict is the one thing
  this app cannot be wrong about, and it is what makes the label read "Approved by you".
- **The unseen dot is NOT `updatedAt`** (`hasUnseenChanges`, `shared/review-types.ts`, TESTED).
  GitHub moves a PR's `updatedAt` for a label, an assignee, a milestone or a title edit as
  readily as for a push, so a timestamp comparison mostly reported bot churn. The record stores
  the head SHA and the comment + review-thread totals as well, and the dot lights when the sha
  MOVED or either count GREW — a deleted comment is not something new to read, and an absent sha
  (`""`, a response with no commit node) is absent, not different. A record written before the
  widening keeps the old timestamp answer rather than going silent. Check status is deliberately
  not an input: it doesn't move `updatedAt` either, and a flapping CI run is not a re-read.

- **`REVIEW_REQUIRED` names no person.** It means "a required review is still missing", never
  whose — so on a view of your OWN PRs it is the codeowners', not you. `ReviewCell` resolves it
  through `awaitsViewer` ("Awaiting you" vs "Awaiting review") and the drawer's bucket is labelled
  "awaiting review"; reading it as "you" was right only by coincidence on `review-requested:@me`.
  For the same reason `reviewVerdictOf` lets an explicit `REVIEW_REQUIRED` BEAT `approvalCount` —
  under CODEOWNERS a teammate's approval leaves the decision required, and counting it as approved
  put the PR in `ready`, the one state that reads as a one-click merge. The raw count is the
  fallback for repos with no branch protection, nothing more.
- **`blocked on you` has TWO entrances, and only one of them is a review** (`pulseOf`,
  `shared/pulse.ts`, TESTED). Your own PR with red checks is blocked on you exactly as much as a
  review you owe someone — same court, same urgency — so it is one state, not six. But the hint
  was a flat `Record<PulseState, string>` saying "your review is what it is waiting for", which
  told every author of a failing PR to review their own work. A ROW resolves state, reason and
  hint together (`pulseOf`) and paints the reason's icon (`PULSE_REASON_ICON`: eye vs wrench);
  aggregate surfaces — the header pill, the drawer legend — are counting a bucket that mixes both
  and keep `PULSE_HINTS`, which now names both doors. The LABEL does not fork: a row reading
  "needs your fix" would stop echoing the pill segment you filtered with. Neither does the COLOR —
  pulse wears the reserved status tokens, not a per-reason palette.
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
