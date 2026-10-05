import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateHarvestEventDto,
  MeteoAlert,
  MeteoAlertCandidate,
  MeteoAlertSettings,
  MeteoFarmWeather,
  MeteoParcelClimate,
  MeteoParcelWeather,
  MeteoParcelWeatherCompact,
  UpdateMeteoAlertSettingsDto,
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

// ── Iteration 2: parcel weather, climate, farm map, alerts ───────────────────

const isForbidden = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { status?: number }).status === 403;

/** Weather for ANY parcel (no drying clock needed). Spends external quota → cached server-side. */
export function useMeteoParcelWeather<V extends 'full' | 'compact' = 'full'>(
  client: ApiClient,
  parcelId: string,
  view: V = 'full' as V,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.meteo.weather(parcelId, view),
    queryFn: () =>
      client.get<V extends 'compact' ? MeteoParcelWeatherCompact : MeteoParcelWeather>(
        `/api/v1/meteo/parcels/${encodeURIComponent(parcelId)}/weather?view=${view}`,
      ),
    enabled: !!parcelId && (opts?.enabled ?? true),
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
}

/** ERA5 climatology + GDD. Polls every minute while the normals are being computed. */
export function useMeteoParcelClimate(
  client: ApiClient,
  parcelId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.meteo.climate(parcelId),
    queryFn: () =>
      client.get<MeteoParcelClimate>(`/api/v1/meteo/parcels/${encodeURIComponent(parcelId)}/climate`),
    enabled: !!parcelId && (opts?.enabled ?? true),
    staleTime: 60 * 60_000,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 60_000 : false),
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
}

export function useMeteoFarmWeather(client: ApiClient, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.farm(),
    queryFn: () => client.get<MeteoFarmWeather>('/api/v1/meteo/farm-weather'),
    enabled: opts?.enabled ?? true,
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
}

export function useMeteoAlerts(client: ApiClient, days = 7, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.alerts(days),
    queryFn: () => client.get<MeteoAlert[]>(`/api/v1/meteo/alerts?days=${days}`),
    enabled: opts?.enabled ?? true,
    refetchInterval: 5 * 60_000,
  });
}

export function useAckMeteoAlert(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<MeteoAlert>(`/api/v1/meteo/alerts/${encodeURIComponent(id)}/ack`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

export function useMeteoAlertSettings(client: ApiClient, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.meteo.alertSettings(),
    queryFn: () => client.get<MeteoAlertSettings>('/api/v1/meteo/alert-settings'),
    enabled: opts?.enabled ?? true,
  });
}

export function useUpdateMeteoAlertSettings(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateMeteoAlertSettingsDto) =>
      client.put<MeteoAlertSettings>('/api/v1/meteo/alert-settings', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}

/** Admin "test now": dryRun returns candidates without writing or notifying. */
export function useEvaluateMeteoAlerts(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (opts: { dryRun: boolean }) =>
      client.post<{ candidates: MeteoAlertCandidate[]; queued: boolean }>(
        `/api/v1/meteo/alerts/evaluate?dryRun=${opts.dryRun ? 'true' : 'false'}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meteo.all });
    },
  });
}
