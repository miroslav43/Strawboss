import { useQuery } from '@tanstack/react-query';
import type { MachineLastLocation } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/** Admin-only: last known GPS position per machine. */
export function useMachineLocations(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.location.machines(),
    queryFn: () => client.get<MachineLastLocation[]>('/api/v1/location/machines'),
    refetchInterval: 30_000, // poll every 30 s for future live-tracking readiness
  });
}
