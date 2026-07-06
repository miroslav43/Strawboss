import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConsumableLog } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export interface ConsumableLogFilters {
  machineId?: string;
  parcelId?: string;
  /** Inclusive ISO lower bound on logged_at, e.g. '2026-07-01T00:00:00Z'. */
  dateFrom?: string;
  /** Inclusive ISO upper bound on logged_at, e.g. '2026-07-31T23:59:59Z'. */
  dateTo?: string;
}

/**
 * List consumable logs with an optional machine + date-range filter. Returns the
 * raw (snake_case) backend rows as `unknown` — the caller normalizes/shapes them
 * (the `SELECT *` endpoint does not camelCase). Query is disabled until a
 * `machineId` is present so the machine-detail card never fetches org-wide.
 */
export function useConsumableLogsList(client: ApiClient, filters: ConsumableLogFilters) {
  return useQuery({
    queryKey: queryKeys.consumableLogs.list(filters as Record<string, unknown>),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.machineId) params.set('machineId', filters.machineId);
      if (filters.parcelId) params.set('parcelId', filters.parcelId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      const qs = params.toString();
      return client.get<unknown>(`/api/v1/consumable-logs${qs ? `?${qs}` : ''}`);
    },
    enabled: !!filters.machineId,
  });
}

export function useCreateConsumableLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ConsumableLog>) =>
      client.post<ConsumableLog>('/api/v1/consumable-logs', data),
    onSuccess: () => {
      // `.all` is the ['consumableLogs'] prefix → invalidates list/byMachine too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.consumableLogs.all });
    },
  });
}

export function useUpdateConsumableLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ConsumableLog> }) =>
      client.patch<ConsumableLog>(`/api/v1/consumable-logs/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.consumableLogs.all });
    },
  });
}

export function useDeleteConsumableLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/consumable-logs/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.consumableLogs.all });
    },
  });
}
