import { useQuery } from '@tanstack/react-query';
import type { MachineLastLocation } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Last known GPS position of a single machine, but only if it reported within
 * the last `windowMinutes` (server-enforced). Returns null when there is no
 * recent fix — the caller (driver trip screen) then falls back to the loading
 * field. Unlike `useNearbyLoaders` this is NOT proximity-filtered to the truck,
 * so it resolves "where is this loader" from any distance.
 */
export function useMachineLastLocation(machineId: string | null, windowMinutes = 30) {
  const userId = useAuthStore((s) => s.userId);
  return useQuery({
    queryKey: ['machine-last-location', machineId, windowMinutes],
    queryFn: () =>
      mobileApiClient.get<MachineLastLocation | null>(
        `/api/v1/location/machine/${machineId}/last?windowMinutes=${windowMinutes}`,
      ),
    enabled: !!userId && !!machineId,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}
