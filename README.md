# Tandem

A native GitHub review client with an agent that has already read the PR.

The agent pre-reads every pull request in your queue and drafts review comments
into **your** local pending review. You accept, edit, or reject each one, add
your own, and submit a single review under your name.

It is not a review bot. It is a faster review client that happens to have
already read the code.

<!-- TODO: screenshot — queue + PR detail -->

## Three principles

1. **The agent never writes to GitHub.** Agent output lands in a local draft.
   The only mutations are the human pressing _Submit review_ or _Approve_. The
   `claude` CLI runs with `--safe-mode --tools ''` — no write tool exists.
2. **The agent runs when you ask.** Analysis starts from the rerun button (`r`).
   Flip _Run automatically_ in Settings to pre-warm PRs as they enter your queue
   instead.
3. **Provenance is always visible.** One reserved color (violet) marks
   everything machine-authored, and nothing else.

## What it does

- **Queue** — saved GitHub search views as tabs, one request per view in
  parallel. Live checks, thread counts, age, churn, unseen-changes markers. A
  stats drawer (`s`) breaks the view down by author, repo, size, idle time,
  checks, review state; every mark is a click-to-filter facet.
- **Review surface** — three panes: file tree, diff (split or unified), agent
  pane. Click any line to comment, optionally with an exact-replacement
  suggestion. Per-file _viewed_ checkboxes fold as you go. Everything inline is
  an annotation: human threads, your staged comments, agent findings.
- **The agent** — three read-only passes per `(PR, head sha)`: orient (plan),
  analyze (per file cluster), reconcile (dedupe, rank, cap, score
  merge-readiness 0–100). Findings must anchor to real diff lines; duplicates of
  existing human threads are dropped. A new head sha marks the old run stale and
  re-anchors your draft rather than deleting anything.
- **Chat** — a fourth pass, scoped to the PR or to one finding. Ask why it
  flagged something, whether it still believes it, how to reword the comment.
  Its edits arrive as proposals you apply with a click.
- **Agent profiles** — each profile carries its own per-pass models and prompt
  blocks, so you can keep a general reviewer alongside a security sweep or a
  test-coverage pass.

## Requirements

- **[Bun](https://bun.sh) ≥ 1.3** — the server and the native shell run on it
  (`bun-types` is pinned to ~1.3.x until webview-bun handles Bun 1.4's FFI
  pointer type).
- **pnpm** and Node ≥ 20.19 (or ≥ 22.12) for the Vite dev server and tooling.
- **macOS** for `pnpm build:app`. The web app itself is platform-agnostic.
- **[Claude Code](https://claude.com/claude-code)** on your PATH, logged in, for
  agent features. Everything else works without it.
- A GitHub personal access token with **repo read + pull requests write**.

## Running it

```bash
pnpm install
pnpm dev:all      # Bun server + Vite → http://localhost:5173
# — or in two terminals —
pnpm start        # Bun server, all /api/*, first free port from 5274
pnpm dev          # Vite; proxies /api/* to the Bun server

pnpm build:app    # macOS → dist-bin/Tandem.app (+ a dist-bin/tandem CLI)
pnpm test         # vitest — pure logic only
pnpm typecheck && pnpm lint
```

Dev needs **both** processes: the Vite proxy forwards all of `/api/*` to the Bun
server, and there is no server-side HMR — restart `pnpm start` after touching a
route.

## Configuration

First run asks for the token. It is stored chmod-600 in `~/.tandem/config.json`
and never reaches the browser bundle — the server holds the credential and
exposes typed endpoints instead of proxying GitHub. In dev, `GITHUB_TOKEN` (plus
optional `GITHUB_ORG`) in the environment seeds the config. `TANDEM_HOME`
relocates the whole state directory, which is the sane way to try things:

```bash
TANDEM_HOME=/tmp/tandem-scratch pnpm start
```

Everything lives in that directory as 0600 JSON: the token, settings (caps,
models, prompts, daily spend ceiling), saved views, pending-review drafts, run
records with findings, and chat transcripts.

## Per-repo tuning

Add `.tandem/conventions.md` to any repo — architecture notes, house patterns,
known deprecations, "we do X not Y" rules. It is read into every agent run for
that repo and is the single biggest quality lever available.

## Keyboard

`?` shows the full sheet. The short version: `j`/`k` move, `Enter` opens, `o`
opens on GitHub, `r` reruns, `s` toggles the stats drawer. In a PR: `[`/`]` step
files, `j`/`k` step findings, `y`/`e`/`x` accept / edit / dismiss one, `c` chats
about it, `v` marks a file viewed, `⌘↵` submits.

## Built on

React 19 + Vite,
[Apollo Wind](https://www.npmjs.com/package/@uipath/apollo-wind) for UI
primitives, [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) and
[@pierre/trees](https://www.npmjs.com/package/@pierre/trees) for the diff and
file tree, TanStack Query, Zustand, Tailwind 4. Server and native shell on Bun +
webview-bun. `pnpm typecheck` runs the native TypeScript 7 compiler (installed
as `typescript7`; the bare `typescript` name stays on 6 for typescript-eslint's
peer range — see CLAUDE.md).

[`CLAUDE.md`](./CLAUDE.md) documents the architecture, the settled design
decisions, and the pitfalls; [`AGENTS.md`](./AGENTS.md) covers collaboration
norms.
