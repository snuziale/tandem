# Tandem

A native review surface for GitHub pull requests where an AI agent reads every PR **before you do**
and drafts review comments into *your* local pending review. You accept, edit, or reject each one,
add your own, and submit a single review under your name.

It is not a review bot. It is a faster review client that happens to have already read the code.

Three principles drive every design decision:

1. **The agent never writes to GitHub.** Agent output lands in a local pending-review draft. The
   only mutations are the human pressing *Submit review* or *Approve*.
2. **Latency is hidden by pre-warming.** Analysis starts when a PR enters your queue, not when you
   open it.
3. **Provenance is always visible.** One reserved color (violet) marks everything machine-authored.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and [`AGENTS.md`](./AGENTS.md) for collaboration norms.

## Running it

```bash
pnpm install
pnpm dev:all                 # Bun server + Vite, http://localhost:5173
# — or in two terminals —
pnpm start                   # Bun server (all /api/*), first free port from 5274
pnpm dev                     # Vite; proxies /api/* to the Bun server

pnpm build:app               # macOS → dist-bin/Tandem.app (+ dist-bin/tandem CLI)
pnpm test                    # vitest (pure logic only)
pnpm typecheck && pnpm lint
```

First run asks for a GitHub personal access token (repo read + pull-request write) — it is stored
chmod-600 in `~/.tandem/config.json` (`$TANDEM_HOME` overrides) and never reaches the browser
bundle. In dev, `GITHUB_TOKEN` (+ optional `GITHUB_ORG`) in the environment seeds the config.

The agent runs through the `claude` CLI (Claude Code) in read-only headless mode — install and log
in to Claude Code for agent features; everything else works without it.

## Per-repo tuning

Add `.tandem/conventions.md` to any repo: architecture notes, house patterns, known deprecations,
"we do X not Y" rules. It is read into every agent run for that repo and is the main quality lever.
