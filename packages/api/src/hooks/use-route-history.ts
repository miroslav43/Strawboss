import { useQuery } from '@tanstack/react-query';
import type { RouteHistoryResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/**
 * Admin-only: GPS route history for a machine within a time range.
 *
 * The server noise-filters the track and splits it into `segments` by default.
 * Pass `raw` to get every stored ping instead — useful for auditing what the
 * filter removed.
 */
export function useRouteHistory(
  client: ApiClient,
  machineId: string | null,
  from: string,
  to: string,
  raw = false,
) {
  return useQuery({
    queryKey: queryKeys.location.route(machineId ?? '', from, to, raw),
    queryFn: () =>
      client.get<RouteHistoryResponse>(
        `/api/v1/location/machines/${machineId}/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${raw ? '&raw=1' : ''}`,
      ),
    enabled: !!machineId,
  });
}
