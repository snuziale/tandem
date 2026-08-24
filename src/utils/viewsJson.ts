// Parse/validate a pasted views-JSON payload (the same array shape stored in
// ~/.tandem/views.json) for the import dialog. Pure — tested.
import { isPlainObject } from "../shared/is-plain-object";
import type { SavedView } from "../shared/review-types";

export function parseViewsJson(
  text: string,
): { views: SavedView[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      error: `invalid JSON: ${e instanceof Error ? e.message : "parse error"}`,
    };
  }
  if (!Array.isArray(raw))
    return { error: "expected a top-level array of views" };
  const views: SavedView[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.query !== "string" ||
      !entry.query.trim()
    ) {
      return { error: `view ${i}: name and query are required strings` };
    }
    views.push({
      id:
        typeof entry.id === "string" && entry.id
          ? entry.id
          : crypto.randomUUID(),
      name: entry.name,
      query: entry.query,
      agentEnabled: entry.agentEnabled === true,
      position: typeof entry.position === "number" ? entry.position : i,
    });
  }
  if (views.length === 0) return { error: "at least one view is required" };
  return { views };
}
