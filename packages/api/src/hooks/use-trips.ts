import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Trip,
  PaginatedResponse,
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  CompleteDto,
  CancelDto,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useTrips(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.trips.list(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<PaginatedResponse<Trip>>(`/api/v1/trips${params}`);
    },
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
