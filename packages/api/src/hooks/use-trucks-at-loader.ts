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
  /** Current (non-terminal) trip status of the truck, or null if none. */
  tripStatus: string | null;
  /** 'loaded' once the truck carries bales; 'empty' while waiting / being loaded. */
  loadState: 'loaded' | 'empty';
}

export interface AssignedTruck {
  tripId: string;
  truckId: string;
  registrationPlate: string | null;
  internalCode: string | null;
  driverName: string | null;
  sourceParcelName: string | null;
  sourceParcelMunicipality: string | null;
  tripStatus: 'planned' | 'loading' | 'loaded';
  isAuxiliary: boolean;
  /** 'here' = within radius; 'enroute' = has GPS but outside radius; 'loaded' = load done; 'unknown' = no recent GPS. */
  presence: 'here' | 'enroute' | 'loaded' | 'unknown';
  /** Truck→loader distance when a recent GPS ping exists; null otherwise. */
  distanceM: number | null;
  lastSeenAt: string | null;
  /** 'loaded' once the trip is loaded; 'empty' while planned/loading. */
  loadState: 'loaded' | 'empty';
}

export interface LoaderBoardResponse {
  /** Non-auxiliary trucks assigned to this loader machine (trips.loader_id), still to-load. */
  assigned: AssignedTruck[];
  /** Trucks within GPS proximity that are NOT in `assigned`. */
  nearbyUnassigned: TruckAtLoader[];
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
      client.get<TruckAtLoader[]>(`/api/v1/location/trucks-at-loader/${loaderMachineId}${qs}`),
    enabled: !!loaderMachineId,
    refetchInterval: options?.pollMs ?? 10_000,
  });
}
