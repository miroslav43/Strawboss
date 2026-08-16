import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeliveryDestination } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/**
 * @param filters carries the optional `season`. It must be part of the query
 *   KEY as well as the query string: every depot row includes a stock figure,
 *   and without the key a season switch would serve the previous season's stock
 *   from cache under the new heading.
 */
export function useDeliveryDestinations(client: ApiClient, filters?: Record<string, unknown>) {
  const qs =
    filters && Object.keys(filters).length
      ? `?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)]))}`
      : '';
  return useQuery({
    queryKey: queryKeys.deliveryDestinations.list(filters),
    queryFn: () => client.get<DeliveryDestination[]>(`/api/v1/delivery-destinations${qs}`),
    staleTime: 30_000,
  });
}

export function useDeliveryDestination(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.deliveryDestinations.detail(id),
    queryFn: () =>
      client.get<DeliveryDestination>(`/api/v1/delivery-destinations/${id}`),
    enabled: !!id,
  });
}

export function useCreateDeliveryDestination(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      data: Omit<
        DeliveryDestination,
        'id' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'
      >,
    ) => client.post<DeliveryDestination>('/api/v1/delivery-destinations', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deliveryDestinations.all,
      });
    },
  });
}

export function useUpdateDeliveryDestination(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<DeliveryDestination>;
    }) =>
      client.patch<DeliveryDestination>(
        `/api/v1/delivery-destinations/${id}`,
        data,
      ),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deliveryDestinations.detail(id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deliveryDestinations.all,
      });
    },
  });
}

export function useDeleteDeliveryDestination(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.delete<void>(`/api/v1/delivery-destinations/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deliveryDestinations.all,
      });
    },
  });
}
