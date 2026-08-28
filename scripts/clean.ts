// `rm -rf` with no shell: `pnpm clean` has to work in cmd.exe and PowerShell,
// not only in a POSIX shell. Bun is already required to run the server and the
// asset-manifest generator, so this costs no new dependency.
import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'dist',
  'dist-bin',
  'dist-ssr',
  'src/server/asset-manifest.ts',
  'node_modules/.vite',
  'node_modules/.tmp',
  '.playwright-mcp',
];

// Bun's `--compile` leavings are named by a build hash, so they need a pattern
// the literal list above can't express — the same one .gitignore uses for them
// (`.*-*.bun-build`); keep the two in step.
const BUN_BUILD_LEAVINGS = /^\..*-.*\.bun-build$/;

const leavings = (await readdir(ROOT)).filter((name) =>
  BUN_BUILD_LEAVINGS.test(name),
);

// Disjoint paths, so there is no ordering between them.
await Promise.all(
  [...TARGETS, ...leavings].map((target) =>
    rm(join(ROOT, target), { recursive: true, force: true }),
  ),
);
