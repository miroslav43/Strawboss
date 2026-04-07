import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Farm } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useFarms(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: () => client.get<Farm[]>('/api/v1/farms'),
    staleTime: 30_000,
  });
}

export function useFarm(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.farms.detail(id),
    queryFn: () => client.get<Farm>(`/api/v1/farms/${id}`),
    enabled: !!id,
  });
}

export function useCreateFarm(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; address?: string }) =>
      client.post<Farm>('/api/v1/farms', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all });
    },
  });
}

export function useUpdateFarm(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Farm, 'name' | 'address'>> }) =>
      client.patch<Farm>(`/api/v1/farms/${id}`, data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all });
    },
  });
}

export function useDeleteFarm(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/farms/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all });
    },
  });
}

/** Assign or unassign a parcel to/from a farm by patching its farmId. */
export function useAssignParcelToFarm(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parcelId, farmId }: { parcelId: string; farmId: string | null }) =>
      client.patch(`/api/v1/parcels/${parcelId}`, { farmId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}
