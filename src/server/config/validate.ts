import {
  GITHUB_CREDENTIAL_FIELDS,
  type GitHubCreds,
} from "../../shared/github-schema";
import { isPlainObject } from "../../shared/isPlainObject";
import type { Config } from "./store";

export type ValidateResult<T> =
  { ok: true; value: T } | { ok: false; reason: string };

export function validateConfig(raw: unknown): ValidateResult<Config> {
  if (!isPlainObject(raw)) return { ok: false, reason: "not an object" };
  const creds = raw.github;
  if (!isPlainObject(creds))
    return { ok: false, reason: "missing github credentials" };

  for (const field of GITHUB_CREDENTIAL_FIELDS) {
    if (field.required && typeof creds[field.key] !== "string") {
      return {
        ok: false,
        reason: `missing required field: github.${field.key}`,
      };
    }
  }
  const value: Config = {
    github: {
      token: String(creds.token),
      defaultOrg: typeof creds.defaultOrg === "string" ? creds.defaultOrg : "",
    } satisfies GitHubCreds,
  };
  return { ok: true, value };
}
