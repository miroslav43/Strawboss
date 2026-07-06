import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

export interface AuxiliaryTrip {
  id: string;
  /** The aux truck's machine id — what register-load expects as `truckId`. */
  truckId: string;
  tripNumber: string | null;
  status: string;
  baleCount: number | null;
  sourceParcelId: string | null;
  externalDriverName: string | null;
  externalDriverPhone: string | null;
  destinationName: string | null;
  truckPlate: string | null;
  truckCode: string | null;
  sourceParcelName: string | null;
  sourceParcelCode: string | null;
  sourceParcelMunicipality: string | null;
  cropType: string | null;
}

interface Options {
  /** Override the default loader machine id (e.g. for admins). */
  loaderMachineId?: string | null;
  /** Polling interval in ms (default 15s). */
  pollMs?: number;
}

/**
 * Auxiliary (external) trucks assigned to this loader, regardless of GPS proximity.
 * These trucks have no GPS device and are assigned explicitly by dispatchers.
 * Polls every 15s by default. Disabled when no machine id is available.
 */
export function useAuxiliaryTrips(options: Options = {}) {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const loaderMachineId = options.loaderMachineId ?? assignedMachineId;

  return useQuery<AuxiliaryTrip[]>({
    queryKey: ['auxiliary-trips-at-loader', loaderMachineId],
    queryFn: () =>
      mobileApiClient.get<AuxiliaryTrip[]>(`/api/v1/trips/auxiliary/at-loader/${loaderMachineId}`),
    enabled: !!loaderMachineId,
    refetchInterval: options.pollMs ?? 15_000,
  });
}
