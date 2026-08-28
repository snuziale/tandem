import { API_PATHS } from "../shared/api-paths";
import type { Team } from "../shared/team-types";
import { apiRequest } from "./http";

export async function fetchTeams(): Promise<Team[]> {
  const { teams } = await apiRequest<{ teams: Team[] }>(API_PATHS.TEAMS);
  return teams;
}

export async function saveTeams(teams: Team[]): Promise<Team[]> {
  const result = await apiRequest<{ teams: Team[] }>(API_PATHS.TEAMS, {
    method: "PUT",
    body: { teams },
  });
  return result.teams;
}
