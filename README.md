# Tandem

A GitHub review client with an agent that has already read the PR.

Tandem shows the PRs waiting on you, lets an agent draft review comments into
**your local draft**, and submits one review under your name once you have
accepted, edited or thrown away what it wrote. The agent never posts anything
itself.

<!-- TODO: screenshot — queue + PR detail -->

## Quick start

You need:

- [Bun](https://bun.sh) 1.3.x, [pnpm](https://pnpm.io), and Node 22.12+
- A GitHub personal access token — see [GitHub token](#github-token) below
  (short version: a classic token with the `repo` scope, SSO-authorized for your
  org)
- For the agent: [Claude Code](https://claude.com/claude-code) installed and
  logged in (`claude --version` works). Everything else runs without it.

```bash
pnpm install
pnpm dev:web          # then open http://localhost:5173
```

Paste your token on the first screen. That's it — the queue opens with two
views, **Needs my review** and **My PRs**.

> Prefer a desktop app? See [Building the app](#building-the-app).

## GitHub token

Tandem acts as you, with your token. It **reads** PRs, diffs, files, checks and
review threads, and it **writes exactly one thing**: the review you submit (or
the approval you click) — `POST /repos/{owner}/{repo}/pulls/{n}/reviews`.
Nothing else is ever written, and the agent never writes at all.

**Classic token (recommended)** —
[create one](https://github.com/settings/tokens/new):

| Scope  | Why                                                                |
| ------ | ------------------------------------------------------------------ |
| `repo` | Read private repos' PRs, files and checks, and submit your reviews |

Public repos only? `public_repo` is enough. No other scope is needed — teams in
Tandem are plain lists of logins, so `read:org` is not used.

**Fine-grained token** — works, with two catches: it covers ONE owner (a view
spanning several orgs misses the others), and the org may need to approve it.
Give it access to the repos you review, with:

| Repository permission | Access                          |
| --------------------- | ------------------------------- |
| Pull requests         | Read and write                  |
| Contents              | Read-only                       |
| Commit statuses       | Read-only                       |
| Metadata              | Read-only (added automatically) |

If the checks column stays empty with a fine-grained token, it cannot see your
CI — switch to a classic token.

**SAML SSO orgs** (e.g. a company org): after creating the token, open it on
GitHub › _Configure SSO_ › _Authorize_ for that org. Without it, that org's PRs
are simply missing from the queue.

The token is checked when you paste it, stored in `~/.tandem/config.json`
(owner-only permissions on macOS/Linux) and never sent to the browser. Change it
later in **Settings › GitHub**. `GITHUB_TOKEN` in the environment seeds it on
first run.

## Your first review

1. **Pick a PR** from the queue (`j`/`k`, `Enter`).
2. **Run the agent** with `r` (or the _Run agent_ button). It takes a minute or
   two; the run log shows what it is reading.
3. **Triage its findings** in the right-hand pane: `y` accept, `e` edit, `x`
   dismiss. Accepted ones go into your draft — nothing is public yet.
4. **Add your own comments**: click a line (drag line numbers for a range).
5. **Ask it things** with `c`: "why is this a blocker?", "reword this comment",
   "who else calls this?".
6. **Submit** from the button in the PR header (`⌘↵`), choosing approve, comment
   or request changes.

Mark files viewed as you go (`v`) — they fold away and the header counts your
progress. Press `?` anytime for every shortcut.

## Getting better reviews

Out of the box the agent reads each changed file in full plus a few related
files it picks (callers, types, tests). Two things make it noticeably better:

**Give it your repo's rules.** It reads `CLAUDE.md`, `AGENTS.md`,
`.github/copilot-instructions.md` and `.tandem/conventions.md` from the repo, so
house rules and known pitfalls you have already written down are used
automatically.

**Let it explore a local clone.** In **Settings › Agent profiles › Context**,
choose _Local checkout_, then add the clone under **Settings › Review policy ›
Local checkouts** (`owner/repo` → `~/code/repo`, then _Check_). The agent then
reviews inside a temporary read-only copy of the PR's commit and can search the
whole codebase. Your own folder, branch and uncommitted work are never touched.
It costs several times the tokens of the default.

You can also create **profiles** — a security sweep, a React or performance lens
— and pick one from the PR's rerun menu.

## Building the app

```bash
pnpm build:app
```

| OS      | Output                | Install                                                                                                                |
| ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| macOS   | `dist-bin/Tandem.app` | Drag it into `/Applications` and open it                                                                               |
| Windows | `dist-bin/tandem.exe` | Run it; needs the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (built into Windows 11) |
| Linux   | `dist-bin/tandem`     | Run it; needs WebKitGTK                                                                                                |

The app is the same server and UI as `pnpm dev:web`, in a window. It uses the
same `~/.tandem`, so your token, views and drafts carry over, and the dev setup
and the app can run side by side. While it runs, the same UI is also at the URL
the app prints (`http://127.0.0.1:5274` unless that port is taken).

- **Agent in the app:** a Mac app opened from Finder or the Dock does not get
  your terminal's PATH; Tandem asks your login shell for it at launch, so a
  `claude` in `~/.local/bin`, Homebrew or nvm is found. If Settings › Review
  policy still says _not found_, make sure `claude` is on the PATH your shell
  profile sets.
- **Updating:** `git pull && pnpm install && pnpm build:app`, then quit (`⌘Q`)
  and reopen. The app shows the UI it was built with — `pnpm dev:web` is the way
  to see changes live.
- **Sharing the .app with someone else:** it is signed ad hoc, which is fine on
  the Mac that built it. On another Mac, macOS blocks the first launch:
  right-click › _Open_, or run
  `xattr -dr com.apple.quarantine /Applications/Tandem.app`.

## Making the queue yours

- **Views** are GitHub searches, one per tab. Click `+` to add one; the `?` next
  to the query box lists the useful qualifiers (`repo:`, `org:`, `label:` …).
- **Teams** (Settings › Teams) let a view say `author:{team}` instead of listing
  people.
- `s` opens a breakdown of the current view; click any bar to filter by it.

## Where things live

Everything — your token, settings, views, drafts, agent runs — is plain JSON in
`~/.tandem`. The token stays on the server side and never reaches the browser.

To try things without touching your real setup:

```bash
TANDEM_HOME=/tmp/tandem-scratch pnpm dev:web
```

## Good to know

- **The agent only runs when you ask.** Turn on _Run automatically_ in Settings
  › Review policy to analyse PRs as they enter your queue. A daily spend ceiling
  (default $20) applies either way.
- **Purple means machine-written.** Anything the agent produced is marked in
  violet, everywhere, so you always know whose words you are about to post.
- **Nothing it writes is public until you press Submit.** Approving or
  submitting are the only things that write to GitHub, and only you trigger
  them. (Optional auto-approve exists, off by default, behind strict gates.)

## Troubleshooting

| Symptom                                            | Fix                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "Run agent" does nothing / agent unavailable       | `claude --version` must work in the shell that started Tandem; Settings › Review policy shows what it found. |
| Run says _would skip · draft_ (or too large)       | Drafts and very large PRs are skipped by policy — adjust in Settings › Review policy.                        |
| New page or setting 404s after pulling             | Restart the server — `pnpm dev:web` again.                                                                   |
| _Blocked on you_ always 0                          | Your token could not be verified; re-check it in Settings › GitHub.                                          |
| Local checkout shows "falling back to whole files" | Press _Check_ on the clone in Settings; the run log says why (wrong remote, fetch timed out…).               |

## Contributing

```bash
pnpm test && pnpm typecheck && pnpm lint    # what CI runs, plus pnpm build
```

[`CLAUDE.md`](./CLAUDE.md) explains the architecture, the design decisions and
the pitfalls; [`AGENTS.md`](./AGENTS.md) covers how changes are made.
