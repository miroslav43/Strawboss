import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  Trip,
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  ConfirmDepotDeliveryDto,
  CompleteDto,
  CancelDto,
  ForceStatusDto,
  RegisterLoadDto,
  RegisterLoadResult,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';
import { fetchAllPages, type LedgerResult } from './paged-ledger.js';

/**
 * `GET /api/v1/trips` returns a bare JSON array of raw snake_case trip rows
 * (see `TripsService.list()`), not a `PaginatedResponse<Trip>`. Callers must
 * route the result through `normalizeList()` + `toTripCamelList()` (in
 * `apps/admin-web/src/lib/trip-mapper.ts`) before reading camelCase fields.
 */
export function useTrips(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.trips.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<unknown[]>(`/api/v1/trips${params}`);
    },
  });
}

/**
 * Every trip matching `filters`, across as many server pages as it takes.
 *
 * The Curse report sorts and searches client-side over a whole season, so it
 * needs the complete set — `useTrips` would hand it only the newest 1000 rows
 * and no way to know rows were missing. Uses the `pageSize`/`offset` pair on
 * `GET /trips` (opt-in; omitting them is what keeps every other caller's
 * response unchanged) and reads the `total_count` window column the server adds
 * on that path.
 *
 * Rows come back RAW and snake_case, exactly as `useTrips` returns them — run
 * them through `normalizeList()` + `toTripCamelList()` before reading fields.
 */
export function useAllTrips(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: { enabled?: boolean },
) {
  return useQuery<LedgerResult<unknown>>({
    queryKey: queryKeys.trips.listAll(filters),
    enabled: options?.enabled ?? true,
    // A filter change is a NEW query key, so without this `data` goes undefined
    // and the consumer swaps its table for a spinner — remounting it and losing
    // the column sort the operator just picked, on every debounced keystroke.
    // Same reason as `useAllTripRequests`.
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchAllPages<unknown>(
        client,
        '/api/v1/trips',
        (offset, pageSize) =>
          `?${new URLSearchParams({
            ...((filters ?? {}) as Record<string, string>),
            pageSize: String(pageSize),
            offset: String(offset),
          })}`,
        // `total_count` rides on every row of the paged query (count(*) OVER()),
        // so the first row of the first page is enough — and an empty first page
        // legitimately yields undefined, which falls back to rows.length = 0.
        (page) => {
          const first = page[0] as Record<string, unknown> | undefined;
          const raw = first?.total_count;
          return raw === undefined || raw === null ? undefined : Number(raw);
        },
      ),
  });
}

export function useTrip(client: ApiClient, tripId: string) {
  return useQuery({
    queryKey: queryKeys.trips.detail(tripId),
    queryFn: () => client.get<Trip>(`/api/v1/trips/${tripId}`),
    enabled: !!tripId,
  });
}

export function useCreateTrip(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TripCreateDto) => client.post<Trip>('/api/v1/trips', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useStartLoading(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: StartLoadingDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/start-loading`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useCompleteLoading(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data?: CompleteLoadingDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/complete-loading`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useDepart(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: DepartDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/depart`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useArrive(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ArriveDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/arrive`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useStartDelivery(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data?: StartDeliveryDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/start-delivery`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useConfirmDelivery(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ConfirmDeliveryDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/confirm-delivery`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

/**
 * Depot-operator delivery confirmation (online path). A depot_manager confirms
 * the arriving bale count (+weights on a principal depot) and signs; the single
 * action drives the trip arrived→delivered→completed server-side. Mobile uses the
 * offline sync queue instead; this hook is for admin/online use.
 */
export function useConfirmDepotDelivery(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ConfirmDepotDeliveryDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/confirm-depot-delivery`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.depotInventory.all });
    },
  });
}

export function useCompleteTrip(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: CompleteDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/complete`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

export function useCancelTrip(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: CancelDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/cancel`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

/** Admin-only manual status override (bypasses the state machine). */
export function useForceTripStatus(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ForceStatusDto }) =>
      client.post<Trip>(`/api/v1/trips/${tripId}/force-status`, data),
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}

/**
 * Atomic loader "register load" — single mutation that finds/creates the trip
 * for (truck, today), inserts a `bale_loads` row, and transitions the trip to
 * `loaded`. Idempotent on `idempotencyKey` (the client-side bale_load UUID).
 */
export function useRegisterLoad(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RegisterLoadDto) =>
      client.post<RegisterLoadResult>('/api/v1/trips/register-load', data),
    onSuccess: (result) => {
      const tripId = (result?.trip?.id as string | undefined) ?? undefined;
      if (tripId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.baleLoads.byTrip(tripId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.baleLoads.all });
    },
  });
}

/**
 * Soft-delete a trip. Detaches any linked task_assignment on the server
 * so re-configuring that task can re-trigger auto-creation.
 */
export function useDeleteTrip(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => client.delete<{ id: string }>(`/api/v1/trips/${tripId}`),
    onSuccess: (_data, tripId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
    },
  });
}
