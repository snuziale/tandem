// Generated/vendored/lockfile detection, used by the agent skip rules and to
// annotate FileChange.isGenerated for the UI. Path-pattern based — GitHub's
// linguist-generated attribute isn't available through the pulls API.

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'go.sum',
  'packages.lock.json',
]);

const GENERATED_DIRS = /(^|\/)(vendor|vendored|node_modules|dist|build|out|__snapshots__|\.yarn)\//i;

const GENERATED_SUFFIXES = /\.(min\.js|min\.css|map|pb\.go|pb\.py|generated\.ts|generated\.cs|g\.cs|d\.ts\.map|snap)$/i;

const GENERATED_MARKERS = /(^|\/)(.*\.(sql|graphql)\.ts|schema\.(json|graphql)|swagger\.(json|yaml)|openapi\.(json|yaml))$/i;

export function isLockfile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return LOCKFILES.has(base);
}

export function isGeneratedPath(path: string): boolean {
  return isLockfile(path) || GENERATED_DIRS.test(path) || GENERATED_SUFFIXES.test(path) || GENERATED_MARKERS.test(path);
}
