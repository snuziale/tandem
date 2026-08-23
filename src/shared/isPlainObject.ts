// Narrowing predicate for "plain JSON object" — non-null, typeof 'object',
// not an array. Shared between server validators and client state stores.
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
