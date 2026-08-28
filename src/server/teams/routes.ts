// /api/teams — the whole list, GET and PUT, exactly like /api/views.
import { API_PATHS } from "../../shared/api-paths";
import type { Team } from "../../shared/team-types";
import { parseJsonBody } from "../requestJson";
import { loadTeams, saveTeams, validateTeam } from "./store";

export async function handleTeams(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== API_PATHS.TEAMS)
    return new Response("Not Found", { status: 404 });

  if (req.method === "GET") return Response.json({ teams: await loadTeams() });

  if (req.method === "PUT") {
    const body = await parseJsonBody(req);
    const raw = (body as { teams?: unknown })?.teams;
    if (!Array.isArray(raw))
      return Response.json(
        { error: "expected { teams: Team[] }" },
        { status: 400 },
      );
    const teams = raw.map(validateTeam);
    if (teams.some((t) => t === null))
      return Response.json(
        { error: "invalid team (id and name are required)" },
        { status: 400 },
      );
    await saveTeams(teams as Team[]);
    return Response.json({ teams: await loadTeams() });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
