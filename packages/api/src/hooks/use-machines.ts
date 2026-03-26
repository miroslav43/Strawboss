import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Machine, PaginatedResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useMachines(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.machines.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<PaginatedResponse<Machine>>(`/api/v1/machines${params}`);
    },
  });
}

export function useMachine(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.machines.detail(id),
    queryFn: () => client.get<Machine>(`/api/v1/machines/${id}`),
    enabled: !!id,
  });
}

export function useCreateMachine(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Machine>) => client.post<Machine>('/api/v1/machines', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.machines.all });
    },
  });
}

export function useUpdateMachine(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Machine> }) =>
      client.patch<Machine>(`/api/v1/machines/${id}`, data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.machines.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.machines.all });
    },
  });
}
