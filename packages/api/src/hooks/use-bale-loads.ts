import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BaleLoad } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useBaleLoads(client: ApiClient, tripId: string) {
  return useQuery({
    queryKey: queryKeys.baleLoads.byTrip(tripId),
    queryFn: () => client.get<BaleLoad[]>(`/api/v1/trips/${tripId}/bale-loads`),
    enabled: !!tripId,
  });
}

export function useCreateBaleLoad(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: Partial<BaleLoad> }) =>
      client.post<BaleLoad>(`/api/v1/trips/${tripId}/bale-loads`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.baleLoads.byTrip(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
    },
  });
}
