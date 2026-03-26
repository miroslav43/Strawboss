import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FuelLog } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useFuelLogs(client: ApiClient, machineId?: string) {
  return useQuery({
    queryKey: machineId ? queryKeys.fuelLogs.byMachine(machineId) : queryKeys.fuelLogs.all,
    queryFn: () => {
      const path = machineId
        ? `/api/v1/fuel-logs?machineId=${machineId}`
        : '/api/v1/fuel-logs';
      return client.get<FuelLog[]>(path);
    },
  });
}

export function useCreateFuelLog(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<FuelLog>) =>
      client.post<FuelLog>('/api/v1/fuel-logs', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fuelLogs.all });
    },
  });
}
