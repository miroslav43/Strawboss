import { useQuery } from '@tanstack/react-query';
import type { RouteHistoryResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/** Admin-only: GPS route history for a machine within a time range. */
export function useRouteHistory(
  client: ApiClient,
  machineId: string | null,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: queryKeys.location.route(machineId ?? '', from, to),
    queryFn: () =>
      client.get<RouteHistoryResponse>(
        `/api/v1/location/machines/${machineId}/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!machineId,
  });
}
