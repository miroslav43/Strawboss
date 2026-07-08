import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

export interface NearbyLoader {
  id: string;
  registrationPlate: string | null;
  internalCode: string | null;
  operatorName: string | null;
  distanceM: number;
  lastSeenAt: string;
  lat: number;
  lon: number;
}

/**
 * Loaders currently within GPS proximity of the driver's assigned truck.
 * Mirror of the loader's "trucks at loader" view.
 */
export function useNearbyLoaders() {
  const userId = useAuthStore((s) => s.userId);
  const truckId = useAuthStore((s) => s.assignedMachineId);
  return useQuery({
    queryKey: ['nearby-loaders', truckId],
    queryFn: () =>
      mobileApiClient.get<NearbyLoader[]>(`/api/v1/location/loaders-near-truck/${truckId}`),
    enabled: !!userId && !!truckId,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}
