# AGENTS.md

How to collaborate with the human on this repo. Defer to the current conversation when in doubt.
For codebase architecture, settled decisions, and pitfalls, see [`CLAUDE.md`](./CLAUDE.md).

## Response style

- Terse. Skip restating the question. One sentence of intent before tool calls, 1–3 sentences of
  what changed after. No "let me" / "I'll now" wrappers.
- Default to <200 words per turn unless asked for depth (plans, reviews, architecture).
- End on the actionable detail (file changed, what to test, next obvious step). No sign-offs.

## Minimalism — no premature abstractions

- Don't add an abstraction unless a third concrete need exists.
- Don't add error handling for impossible cases; don't refactor while fixing a bug.
- When asked for X, do X — don't bundle in Y.
- Before adding any helper or option: "would removing this make the code wrong today?" If no, don't.

Track record: GitHub-only config (no provider registry — other forges are a spec non-goal), a lean
run store instead of Sift's full RunEvent zoo, findings embedded in runs rather than a store of
their own.

## Product lines that are NOT open for casual change

- The agent never writes to GitHub. Widening `github/submit.ts` needs an explicit human decision.
- Violet is provenance only.
- No unattended writes of any kind; no auto-retry of failed agent runs.

## Drive, don't ask

Execute by default. Ask only for: irreversible consequences, a real architectural fork with
different long-term costs, or genuinely unreadable intent. Otherwise pick what CLAUDE.md's
"Design decisions" already chose and surface the choice in one line afterwards.

## Commit cadence

- Never commit unprompted (milestone commits during an agreed build plan count as prompted).
- Batch related changes; lowercase subject ~60 chars, body wrapped ~72, present tense.
- Run `git status --short`, `git diff --stat HEAD`, `git log --oneline -3` in parallel first.
- Include the `Co-Authored-By: Claude` line. Never `--no-verify`, never amend published commits.

## Verification bar

- `pnpm test && pnpm typecheck && pnpm lint` green before any milestone commit.
- Server route changes: restart the Bun server and hit the route (dev has no server HMR).
- UI changes: look at it (Playwright screenshot or the browser), don't assume.
- GitHub writes: verify against a throwaway scratch repo of your own, never on teammates' real PRs.
- New pure logic ships with a co-located `*.test.ts`.
