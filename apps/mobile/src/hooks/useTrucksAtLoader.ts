import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { TruckAtLoader } from '@strawboss/api';

interface Options {
  /** Override the default loader machine id (e.g. for admins). */
  loaderMachineId?: string | null;
  radiusM?: number;
  windowMinutes?: number;
  /** Polling interval in ms (default 10s). */
  pollMs?: number;
}

/**
 * Trucks currently within proximity of the loader's machine.
 * Polls every 10s by default. Disabled when no machine id is available.
 */
export function useTrucksAtLoader(options: Options = {}) {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const loaderMachineId = options.loaderMachineId ?? assignedMachineId;

  const params = new URLSearchParams();
  if (options.radiusM != null) params.set('radiusM', String(options.radiusM));
  if (options.windowMinutes != null) params.set('windowMinutes', String(options.windowMinutes));
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery<TruckAtLoader[]>({
    queryKey: ['trucks-at-loader', loaderMachineId, options.radiusM, options.windowMinutes],
    queryFn: () =>
      mobileApiClient.get<TruckAtLoader[]>(
        `/api/v1/location/trucks-at-loader/${loaderMachineId}${qs}`,
      ),
    enabled: !!loaderMachineId,
    refetchInterval: options.pollMs ?? 10_000,
  });
}
