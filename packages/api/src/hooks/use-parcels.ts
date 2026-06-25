import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Parcel,
  PaginatedResponse,
  ParcelImportRequest,
  ParcelImportResult,
  ParcelBaleAvailability,
  OverrideBalesDto,
  TransferToDepotDto,
} from '@strawboss/types';
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

/**
 * Bulk-import parcels from a parsed KML file. Upserts by `(code, organization_id)`
 * server-side, so re-importing the same file updates rather than duplicates.
 * Invalidates both the parcels and farms caches (farm field counts change).
 */
export function useImportParcels(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ParcelImportRequest) =>
      client.post<ParcelImportResult>('/api/v1/parcels/import', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all });
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
 * Live `{ produced, loaded, remaining }` bale tally for a parcel — operator
 * records plus any admin manual adjustments. Drives the override/transfer modal.
 */
export function useParcelBaleAvailability(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.parcels.baleAvailability(id),
    queryFn: () => client.get<ParcelBaleAvailability>(`/api/v1/parcels/${id}/bale-availability`),
    enabled: !!id,
  });
}

/** Admin manual override of a parcel's produced/loaded counts (admin only). */
export function useOverrideParcelBales(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: OverrideBalesDto }) =>
      client.post<ParcelBaleAvailability>(`/api/v1/parcels/${id}/override-bales`, data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.baleAvailability(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}

/**
 * Transfer a parcel's produced bales straight into a depot (admin only). The
 * server creates a virtual completed trip, so trips / bale-loads / depot
 * inventory caches are all invalidated alongside the parcel tally.
 */
export function useTransferParcelToDepot(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TransferToDepotDto }) =>
      client.post<ParcelBaleAvailability>(`/api/v1/parcels/${id}/transfer-to-depot`, data),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.baleAvailability(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.baleLoads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.depotInventory.all });
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
    mutationFn: ({ id, boundary }: { id: string; boundary: object | string }) =>
      // The API stores the boundary as a stringified GeoJSON geometry (the
      // create + import paths do the same). Stringify objects so the
      // `updateParcelSchema` (boundary: string) accepts the payload.
      client.patch<Parcel>(`/api/v1/parcels/${id}`, {
        boundary: typeof boundary === 'string' ? boundary : JSON.stringify(boundary),
      }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.parcels.all });
    },
  });
}
