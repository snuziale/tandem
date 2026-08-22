import { chmod, link, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_BIN = join(ROOT, 'dist-bin');

await $`pnpm build`.cwd(ROOT);
// Re-run AFTER the vite build so the manifest embeds the real hashed assets.
await $`pnpm build:manifest`.cwd(ROOT);
await rm(DIST_BIN, { recursive: true, force: true });
await mkdir(DIST_BIN, { recursive: true });

async function compile(outfile: string): Promise<void> {
  await $`bun build --compile src/server/app.ts src/server/worker.ts --outfile ${outfile}`.cwd(ROOT);
}

if (process.platform !== 'darwin') {
  const outfile = join(DIST_BIN, process.platform === 'win32' ? 'tandem.exe' : 'tandem');
  await compile(outfile);
  process.exit(0);
}

const appDir = join(DIST_BIN, 'Tandem.app');
const contentsDir = join(appDir, 'Contents');
const executable = join(contentsDir, 'MacOS', 'tandem');
const resourcesDir = join(contentsDir, 'Resources');

await mkdir(dirname(executable), { recursive: true });
await mkdir(resourcesDir, { recursive: true });
await compile(executable);
await chmod(executable, 0o755);

const iconWorkDir = join(DIST_BIN, '.icon-work');
const iconsetDir = join(iconWorkDir, 'Tandem.iconset');
const innerIcon = join(iconWorkDir, 'Tandem-860.png');
const masterIcon = join(iconWorkDir, 'Tandem-1024.png');
const iconSource = join(ROOT, 'public', 'favicon.svg');

await mkdir(iconsetDir, { recursive: true });
await $`sips -s format png -z 860 860 ${iconSource} --out ${innerIcon}`.quiet();
await $`sips -p 1024 1024 ${innerIcon} --out ${masterIcon}`.quiet();

const iconSlots = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
] as const;

for (const [pixels, filename] of iconSlots) {
  await $`sips -z ${pixels} ${pixels} ${masterIcon} --out ${join(iconsetDir, filename)}`.quiet();
}

await $`iconutil --convert icns --output ${join(resourcesDir, 'Tandem.icns')} ${iconsetDir}`;
await rm(iconWorkDir, { recursive: true, force: true });

const { version } = (await Bun.file(join(ROOT, 'package.json')).json()) as { version: string };
await Bun.write(
  join(contentsDir, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Tandem</string>
  <key>CFBundleExecutable</key>
  <string>tandem</string>
  <key>CFBundleIconFile</key>
  <string>Tandem.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.tandem.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Tandem</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
);

await $`codesign --force --deep --sign - ${appDir}`;
await link(executable, join(DIST_BIN, 'tandem'));

console.log('Built dist-bin/Tandem.app (dist-bin/tandem links to its executable).');
