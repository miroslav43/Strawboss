import { useQuery } from '@tanstack/react-query';
import type { KmByDayResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/**
 * Admin-only: per-day kilometre totals for one machine in the date range
 * [from, to] inclusive (T18).
 */
export function useLocationKmByDay(
  client: ApiClient,
  args: { machineId: string | null; from: string; to: string },
  options?: { enabled?: boolean },
) {
  const { machineId, from, to } = args;
  return useQuery({
    queryKey: queryKeys.location.kmByDay(machineId ?? '', from, to),
    queryFn: () =>
      client.get<KmByDayResponse>(
        `/api/v1/location/machines/${machineId}/km-by-day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: (options?.enabled ?? true) && !!machineId && !!from && !!to,
  });
}
