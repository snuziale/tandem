import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { fetchTeams, saveTeams } from "../api/teams";
import type { Team } from "../shared/team-types";

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    staleTime: Infinity,
  });
}

/** Every team write, plus the queue invalidation each one implies: a team IS
 * part of the query for any view whose `{team}` token points at it. */
export function useTeamActions(teams: Team[] | undefined) {
  const queryClient = useQueryClient();
  const list = teams ?? [];

  const save = useMutation({
    mutationKey: ["teams", "save"],
    mutationFn: (next: Team[]) => saveTeams(next),
    onSuccess: (next) => {
      queryClient.setQueryData(["teams"], next);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) =>
      toast.error("Could not save teams", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });

  return {
    saving: save.isPending,
    replaceAll: (next: Team[]) => save.mutate(next),
    upsert(team: Team) {
      const exists = list.some((t) => t.id === team.id);
      save.mutate(
        exists
          ? list.map((t) => (t.id === team.id ? team : t))
          : [...list, team],
      );
    },
    remove: (id: string) => save.mutate(list.filter((t) => t.id !== id)),
  };
}
