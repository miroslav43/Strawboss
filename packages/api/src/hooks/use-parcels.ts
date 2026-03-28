import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Parcel, PaginatedResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useParcels(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.parcels.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<PaginatedResponse<Parcel>>(`/api/v1/parcels${params}`);
    },
  });
}

export function useParcel(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.parcels.detail(id),
    queryFn: () => client.get<Parcel>(`/api/v1/parcels/${id}`),
    enabled: !!id,
  });
}

export function useCreateParcel(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Parcel>) => client.post<Parcel>('/api/v1/parcels', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}

export function useUpdateParcel(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Parcel> }) =>
      client.patch<Parcel>(`/api/v1/parcels/${id}`, data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}

/** Soft-delete a parcel (admin only). */
export function useDeleteParcel(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/parcels/${id}`),
    // Always refetch after delete — even on error (e.g. already-deleted parcel)
    // so the sidebar cache stays consistent with the DB.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}

/**
 * Convenience mutation for updating only the boundary GeoJSON of a parcel.
 * Accepts a GeoJSON Polygon Feature or Geometry object.
 */
export function useUpdateParcelBoundary(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, boundary }: { id: string; boundary: object }) =>
      client.patch<Parcel>(`/api/v1/parcels/${id}`, { boundary }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}
