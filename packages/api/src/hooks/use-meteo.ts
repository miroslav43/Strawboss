import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateHarvestEventDto,
  CreateMoistureReadingDto,
  MeteoBaleFingerprint,
  MeteoHarvestEvent,
  MeteoMoistureReading,
  MeteoOrgSettings,
  MeteoOverview,
  MeteoParcelDetail,
  MeteoStatus,
  UpdateHarvestEventDto,
  UpdateMeteoSettingsDto,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/** The overview's traffic light is derived at read time — refresh it every 10 min. */
const OVERVIEW_REFRESH_MS = 10 * 60_000;

export function useMeteoStatus(client: ApiClient, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.status(),
    queryFn: () => client.get<MeteoStatus>('/api/v1/meteo/status'),
    staleTime: 5 * 60_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useMeteoSettings(client: ApiClient, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.settings(),
    queryFn: () => client.get<MeteoOrgSettings>('/api/v1/meteo/settings'),
    enabled: opts?.enabled ?? true,
  });
}

export function useUpdateMeteoSettings(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateMeteoSettingsDto) =>
      client.put<MeteoOrgSettings>('/api/v1/meteo/settings', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useMeteoOverview(client: ApiClient, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.overview(),
    queryFn: () => client.get<MeteoOverview>('/api/v1/meteo/overview'),
    refetchInterval: OVERVIEW_REFRESH_MS,
    enabled: opts?.enabled ?? true,
  });
}

export function useMeteoParcel(client: ApiClient, parcelId: string, hours = 72) {
  return useQuery({
    queryKey: queryKeys.meteo.parcel(parcelId, hours),
    queryFn: () =>
      client.get<MeteoParcelDetail>(
        `/api/v1/meteo/parcels/${encodeURIComponent(parcelId)}?hours=${hours}`,
      ),
    refetchInterval: OVERVIEW_REFRESH_MS,
    enabled: !!parcelId,
  });
}

export function useCreateHarvestEvent(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHarvestEventDto) =>
      client.post<MeteoHarvestEvent>('/api/v1/meteo/harvest-events', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useUpdateHarvestEvent(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateHarvestEventDto & { id: string }) =>
      client.patch<MeteoHarvestEvent>(`/api/v1/meteo/harvest-events/${encodeURIComponent(id)}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useCloseHarvestEvent(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<MeteoHarvestEvent>(`/api/v1/meteo/harvest-events/${encodeURIComponent(id)}/close`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useMeteoReadings(client: ApiClient, parcelId: string) {
  return useQuery({
    queryKey: queryKeys.meteo.readings(parcelId),
    queryFn: () =>
      client.get<MeteoMoistureReading[]>(
        `/api/v1/meteo/parcels/${encodeURIComponent(parcelId)}/readings`,
      ),
    enabled: !!parcelId,
  });
}

export function useCreateMeteoReading(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMoistureReadingDto) =>
      client.post<MeteoMoistureReading>('/api/v1/meteo/readings', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useDeleteMeteoReading(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<void>(`/api/v1/meteo/readings/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useMeteoFingerprints(client: ApiClient, parcelId: string) {
  return useQuery({
    queryKey: queryKeys.meteo.fingerprints(parcelId),
    queryFn: () =>
      client.get<MeteoBaleFingerprint[]>(
        `/api/v1/meteo/fingerprints?parcelId=${encodeURIComponent(parcelId)}`,
      ),
    enabled: !!parcelId,
  });
}

export function useMeteoFingerprint(client: ApiClient, baleProductionId: string | null) {
  return useQuery({
    queryKey: queryKeys.meteo.fingerprint(baleProductionId ?? ''),
    queryFn: () =>
      client.get<MeteoBaleFingerprint>(
        `/api/v1/meteo/fingerprints/${encodeURIComponent(baleProductionId as string)}`,
      ),
    enabled: !!baleProductionId,
  });
}

export function useMeteoRecompute(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.post<{ queued: number }>('/api/v1/meteo/recompute'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}
