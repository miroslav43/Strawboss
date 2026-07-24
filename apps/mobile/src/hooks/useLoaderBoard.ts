import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { LoaderBoardResponse } from '@strawboss/api';

interface Options {
  /** Override the default loader machine id (e.g. for admins). */
  loaderMachineId?: string | null;
  radiusM?: number;
  windowMinutes?: number;
  /** Polling interval in ms (default 15s). */
  pollMs?: number;
}

/**
 * The loader's work board: trucks ASSIGNED to this loader (with a here/on-the-way
 * /loaded presence badge) plus trucks merely within GPS proximity that are not
 * assigned. Polls every 15s by default. Disabled when no machine id is available.
 */
export function useLoaderBoard(options: Options = {}) {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const loaderMachineId = options.loaderMachineId ?? assignedMachineId;

  const params = new URLSearchParams();
  if (options.radiusM != null) params.set('radiusM', String(options.radiusM));
  if (options.windowMinutes != null) params.set('windowMinutes', String(options.windowMinutes));
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery<LoaderBoardResponse>({
    queryKey: ['loader-board', loaderMachineId, options.radiusM, options.windowMinutes],
    queryFn: () =>
      mobileApiClient.get<LoaderBoardResponse>(
        `/api/v1/location/loader-board/${loaderMachineId}${qs}`,
      ),
    enabled: !!loaderMachineId,
    refetchInterval: options.pollMs ?? 15_000,
  });
}
