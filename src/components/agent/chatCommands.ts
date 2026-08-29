// The chat composer's two typed affordances: `/command` and `@path`.
//
// Both are CLIENT-side and both are pure, which is the point — the server's
// turn contract does not grow a command vocabulary it would then have to keep
// in step with the UI. A slash command expands into an ordinary question
// before it is sent, so the transcript reads as prose forever after; an
// `@path` mention stays in the text (it is part of what was asked) and is
// ALSO reported separately, so the server can pre-load the file instead of
// waiting for the model to ask for it — a needContext hop is a whole extra
// model call.
import { resolveCodeRef } from "../common/codeRefs";

export type SlashCommand = {
  /** Typed as `/name`. */
  name: string;
  /** One line under the name in the menu. */
  hint: string;
  /** Turns the rest of the line into the question actually sent. */
  expand: (rest: string) => string;
};

/**
 * Deliberately short. These are the five things a reviewer asks over and over
 * — the list is a capability statement, not a command language, and a sixth
 * entry buys less than the row of chips costs.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "explain",
    hint: "what does this code actually do",
    expand: (rest) =>
      `Explain what this does, plainly and without restating the diff${rest ? `: ${rest}` : "."}`,
  },
  {
    name: "suggest",
    hint: "write a comment with an exact replacement",
    expand: (rest) =>
      `Write a review comment for this, with an exact replacement for the lines as a suggestion, and propose it with stage-comment${rest ? `. What I want changed: ${rest}` : "."}`,
  },
  {
    name: "why",
    hint: "why did you flag this",
    expand: (rest) =>
      `Why did you flag this, and what specifically makes it worth my time${rest ? `? ${rest}` : "?"}`,
  },
  {
    name: "test",
    hint: "what test would catch this",
    expand: (rest) =>
      `What test would catch this, and where would it go? Name the file and sketch the case${rest ? `. ${rest}` : "."}`,
  },
  {
    name: "rebut",
    hint: "argue against your own claim",
    expand: (rest) =>
      `Argue AGAINST your own position here as hard as you can. What is the strongest case that this is fine as written${rest ? `? ${rest}` : "?"} If it survives, say so.`,
  },
];

/** The command being typed, for the menu. Null once there is a space — a
 * command is the first token or it is not one. */
export function slashPrefix(input: string): string | null {
  const match = /^\/([a-z]*)$/.exec(input);
  return match ? match[1] : null;
}

export function matchingCommands(prefix: string): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
}

/**
 * What actually gets sent. An unrecognized `/whatever` is left completely
 * alone: the reviewer may simply be typing a path, and silently rewriting
 * their words would be worse than not having the feature.
 */
export function expandSlash(input: string): string {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return input;
  const command = SLASH_COMMANDS.find((c) => c.name === match[1]);
  if (!command) return input;
  return command.expand((match[2] ?? "").trim());
}

/** `@` and what follows it, while the caret is at the end — for the menu. */
export function mentionPrefix(input: string): string | null {
  const match = /(?:^|\s)@([\w./-]*)$/.exec(input);
  return match ? match[1] : null;
}

export function matchingPaths(
  prefix: string,
  paths: readonly string[],
  limit: number,
): string[] {
  if (prefix === "") return paths.slice(0, limit);
  const needle = prefix.toLowerCase();
  return paths.filter((p) => p.toLowerCase().includes(needle)).slice(0, limit);
}

/** Replace the `@…` being typed with a real path, leaving one trailing space. */
export function completeMention(input: string, path: string): string {
  return input.replace(
    /(?:^|\s)@([\w./-]*)$/,
    (whole) => `${whole.startsWith("@") ? "" : " "}@${path} `,
  );
}

/** A token that could name a real file: it has a directory and an extension.
 * The bar for handing something to the server to fetch — `@here` is a word,
 * `@src/a/b.ts` is a path. */
function looksLikePath(token: string): boolean {
  return token.includes("/") && /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(token);
}

/**
 * Every file an `@` mention names.
 *
 * A mention resolves against the PR's own files the way the agent's citations
 * do (`resolveCodeRef`), so `@patch.ts` and `@src/shared/gh/patch.ts` mean the
 * same file and an ambiguous bare name means nothing rather than the wrong
 * thing. A full path that is NOT in the diff passes through unresolved — that
 * is the case the pre-load exists for, and the client cannot know whether the
 * repo has it. The server fetches it read-only and skips a miss.
 */
export function mentionedPaths(
  input: string,
  paths: readonly string[],
): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/(?:^|\s)@([\w./-]+)/g)) {
    const token = m[1];
    const resolved =
      resolveCodeRef({ path: token, line: 1 }, paths) ??
      (looksLikePath(token) ? token : null);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}
