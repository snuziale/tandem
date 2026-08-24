import { API_PATHS } from "../shared/api-paths";
import type {
  ConfigStatus,
  CredentialTestResult,
} from "../shared/config-types";
import { apiRequest } from "./http";

export type {
  ConfigStatus,
  CredentialField,
  CredentialTestResult,
} from "../shared/config-types";

export function fetchConfigStatus(): Promise<ConfigStatus> {
  return apiRequest<ConfigStatus>(API_PATHS.CONFIG_STATUS);
}

export function testCredentials(
  creds: Record<string, string>,
): Promise<CredentialTestResult> {
  return apiRequest<CredentialTestResult>(API_PATHS.CONFIG_TEST, {
    method: "POST",
    body: { creds },
  });
}

export async function saveConfig(
  creds: Record<string, string>,
  options: { update?: boolean } = {},
): Promise<{ ok: true } | { error: string }> {
  try {
    return await apiRequest<{ ok: true }>(API_PATHS.CONFIG, {
      method: options.update ? "PUT" : "POST",
      body: { github: creds },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "save failed" };
  }
}
