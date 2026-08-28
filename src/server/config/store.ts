import { mkdir, chmod } from "node:fs/promises";
import { storageHome, storagePath } from "../storage/jsonFile";
import type { GitHubCreds } from "../../shared/github-credentials";
import { validateConfig } from "./validate";

export type Config = { github: GitHubCreds };

function file(): string {
  return storagePath("config.json");
}

let cached: Config | null = null;
let cacheLoaded = false;
let envSeedAttempted = false;

export async function loadConfig(): Promise<Config | null> {
  if (cacheLoaded) return cached;
  cached = await readConfigFromDisk();
  cacheLoaded = true;
  return cached;
}

async function readConfigFromDisk(): Promise<Config | null> {
  try {
    const text = await Bun.file(file()).text();
    const raw = JSON.parse(text);
    const result = validateConfig(raw);
    if (!result.ok) {
      console.error(
        `[config] ${file()} is invalid (${result.reason}); treating as unconfigured`,
      );
      return null;
    }
    return result.value;
  } catch {
    if (!envSeedAttempted) {
      envSeedAttempted = true;
      const seeded = await seedFromEnv();
      if (seeded) return seeded;
    }
    return null;
  }
}

export async function saveConfig(c: Config): Promise<void> {
  await mkdir(storageHome(), { recursive: true, mode: 0o700 });
  await Bun.write(file(), JSON.stringify(c, null, 2));
  try {
    await chmod(file(), 0o600);
  } catch {
    // Windows ACLs — chmod is a no-op there, so this file inherits the user
    // profile's ACL. Settings › About reports which of the two applies.
  }
  cached = c;
  cacheLoaded = true;
}

export function configPath(): string {
  return file();
}

// GITHUB_TOKEN in the environment seeds the config on first run so dev
// (`bun --env-file` auto-loads .env.local) needs no first-run UI pass.
async function seedFromEnv(): Promise<Config | null> {
  const { GITHUB_TOKEN, GITHUB_ORG } = Bun.env;
  if (!GITHUB_TOKEN) return null;
  const next: Config = {
    github: { token: GITHUB_TOKEN, defaultOrg: GITHUB_ORG ?? "" },
  };
  console.error(
    `[config] seeded ${file()} from GITHUB_TOKEN env; future runs read this file directly`,
  );
  await saveConfig(next);
  return next;
}
