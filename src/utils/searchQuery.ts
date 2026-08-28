// Small pure helpers for editing a GitHub search query by hand — used by the
// query bar and the view editor, which both let you click a qualifier in
// instead of typing it.

/** Appends a qualifier to a query, keeping exactly one separating space. */
export function appendQualifier(query: string, token: string): string {
  const base = query.trimEnd();
  return base ? `${base} ${token}` : token;
}

/** Qualifiers that narrow a search to a repo, an org, or a person. Without one
 * of them the query matches every open PR on GitHub, which is never a queue. */
const SCOPING = [
  "repo",
  "org",
  "user",
  "author",
  "assignee",
  "involves",
  "mentions",
  "review-requested",
  "reviewed-by",
  "commenter",
];

const SCOPE_RE = new RegExp(`(^|\\s)-?(${SCOPING.join("|")}):\\S`, "i");

export function hasScopeQualifier(query: string): boolean {
  return SCOPE_RE.test(query);
}
