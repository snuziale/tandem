// The host OS, named once. Same job as isCompiledBun() in runtime.ts: the
// comparison is trivial, but spelling `process.platform === "win32"` at five
// call sites means five places to get the magic string wrong and no single
// place to add a third branch. Behavior stays where it belongs — each site
// asks its own question (retry gating, message text, which quit key) — this
// only owns the answer to "which OS".
//
// The CLIENT half of this is keyboard/platform.ts, which cannot share code
// with it: that one reads `navigator`, this one reads `process`.
export const IS_WINDOWS = process.platform === "win32";
export const IS_DARWIN = process.platform === "darwin";
