import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Alert, PaginatedResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useAlerts(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.alerts.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<PaginatedResponse<Alert>>(`/api/v1/alerts${params}`);
    },
  });
}

export function useUnacknowledgedAlerts(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.alerts.unacknowledged(),
    queryFn: () => client.get<Alert[]>('/api/v1/alerts?acknowledged=false'),
  });
}

export function useAcknowledgeAlert(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolutionNotes }: { id: string; resolutionNotes?: string }) =>
      client.post<Alert>(`/api/v1/alerts/${id}/acknowledge`, { resolutionNotes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}
