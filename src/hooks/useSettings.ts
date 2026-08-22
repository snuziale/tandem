import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@uipath/apollo-wind';
import { fetchSettings, putSettings } from '../api/settingsApi';
import type { TandemSettings } from '../shared/settings-types';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: fetchSettings, staleTime: Infinity });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TandemSettings>) => putSettings(patch),
    onSuccess: (settings) => queryClient.setQueryData(['settings'], settings),
    onError: (e) => toast.error('Settings not saved', { description: e instanceof Error ? e.message : undefined }),
  });
}
