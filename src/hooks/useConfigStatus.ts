import { useQuery } from '@tanstack/react-query';
import { fetchConfigStatus } from '../api/configApi';

// Single definition of the /api/config/status query, shared by Bootstrap
// (gates first-run setup) and anything needing the authenticated login.
// Same query key → React Query dedupes to one request.
export function useConfigStatus() {
  return useQuery({
    queryKey: ['config', 'status'],
    queryFn: fetchConfigStatus,
    staleTime: Infinity,
    retry: 1,
  });
}
