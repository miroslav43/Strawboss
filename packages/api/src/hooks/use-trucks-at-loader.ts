import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export interface TruckAtLoader {
  id: string;
  registrationPlate: string | null;
  internalCode: string | null;
  driverName: string | null;
  distanceM: number;
  lastSeenAt: string;
  lat: number;
  lon: number;
}

/**
 * Loader-only: trucks currently within proximity of the loader machine.
 * Polls every 10s so the loader sees arrivals/departures without manual refresh.
 */
export function useTrucksAtLoader(
  client: ApiClient,
  loaderMachineId: string | null | undefined,
  options?: { radiusM?: number; windowMinutes?: number; pollMs?: number },
) {
  const params = new URLSearchParams();
  if (options?.radiusM != null) params.set('radiusM', String(options.radiusM));
  if (options?.windowMinutes != null) params.set('windowMinutes', String(options.windowMinutes));
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: queryKeys.location.trucksAtLoader(loaderMachineId ?? ''),
    queryFn: () =>
      client.get<TruckAtLoader[]>(
        `/api/v1/location/trucks-at-loader/${loaderMachineId}${qs}`,
      ),
    enabled: !!loaderMachineId,
    refetchInterval: options?.pollMs ?? 10_000,
  });
}
