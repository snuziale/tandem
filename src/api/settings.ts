import { API_PATHS } from "../shared/api-paths";
import type { CloneCheck, TandemSettings } from "../shared/settings-types";
import { apiRequest } from "./http";

export async function fetchSettings(): Promise<TandemSettings> {
  const { settings } = await apiRequest<{ settings: TandemSettings }>(
    API_PATHS.SETTINGS,
  );
  return settings;
}

export async function putSettings(
  patch: Partial<TandemSettings>,
): Promise<TandemSettings> {
  const { settings } = await apiRequest<{ settings: TandemSettings }>(
    API_PATHS.SETTINGS,
    { method: "PUT", body: patch },
  );
  return settings;
}

export async function checkClone(
  repo: string,
  path: string,
): Promise<CloneCheck> {
  return apiRequest<CloneCheck>(API_PATHS.SETTINGS_CHECK_CLONE, {
    method: "POST",
    body: { repo, path },
  });
}
