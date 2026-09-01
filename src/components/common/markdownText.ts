/**
 * PR templates ship their guidance as HTML comments, so the comments are the
 * one thing a PR body almost always has and a reader never wants.
 *
 * Two callers need them gone and for different reasons — `Markdown` because
 * `rehype-raw` would otherwise keep them as comment nodes, and the description
 * tab because a body that is ONLY the template is an empty description and
 * must disable its tab. They were two regexes in two files, and `Markdown`'s
 * own comment justified itself by naming the check that had since moved out
 * of it. One spelling, so a change to template syntax is found once.
 */
export function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}
