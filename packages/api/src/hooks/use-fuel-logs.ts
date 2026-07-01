import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FuelLog } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useFuelLogs(client: ApiClient, machineId?: string) {
  return useQuery({
    queryKey: machineId ? queryKeys.fuelLogs.byMachine(machineId) : queryKeys.fuelLogs.all,
    queryFn: () => {
      const path = machineId ? `/api/v1/fuel-logs?machineId=${machineId}` : '/api/v1/fuel-logs';
      return client.get<FuelLog[]>(path);
    },
  });
}

export function useCreateFuelLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<FuelLog>) => client.post<FuelLog>('/api/v1/fuel-logs', data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fuelLogs.all });
      if (data.machineId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.fuelLogs.byMachine(data.machineId),
        });
      }
    },
  });
}

export interface FuelLogFilters {
  machineId?: string;
  /** Inclusive ISO lower bound on logged_at, e.g. '2026-07-01T00:00:00Z'. */
  dateFrom?: string;
  /** Inclusive ISO upper bound on logged_at, e.g. '2026-07-31T23:59:59Z'. */
  dateTo?: string;
}

/**
 * List fuel logs with an optional machine + date-range filter. Returns the raw
 * (snake_case) backend rows as `unknown` — the caller normalizes/shapes them
 * (the `SELECT *` endpoint does not camelCase). Query is disabled until a
 * `machineId` is present so the machine-detail page never fetches org-wide.
 */
export function useFuelLogsList(client: ApiClient, filters: FuelLogFilters) {
  return useQuery({
    queryKey: queryKeys.fuelLogs.list(filters as Record<string, unknown>),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.machineId) params.set('machineId', filters.machineId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      const qs = params.toString();
      return client.get<unknown>(`/api/v1/fuel-logs${qs ? `?${qs}` : ''}`);
    },
    enabled: !!filters.machineId,
  });
}

export function useUpdateFuelLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FuelLog> }) =>
      client.patch<FuelLog>(`/api/v1/fuel-logs/${id}`, data),
    onSuccess: () => {
      // `.all` is the ['fuelLogs'] prefix → invalidates list/byMachine queries too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.fuelLogs.all });
    },
  });
}

export function useDeleteFuelLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/fuel-logs/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fuelLogs.all });
    },
  });
}
