import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CloseSeasonDto,
  CloseSeasonResult,
  SeasonContext,
  SeasonPreflight,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';

const seasonsKey = ['seasons'] as const;
const seasonPreflightKey = (year: number) => ['seasons', 'preflight', year] as const;

/**
 * Which seasons this organization has, and which one it is reading by default.
 *
 * Fetched once and shared by the whole dashboard through SeasonProvider. Open
 * to every authenticated role: knowing which year you are looking at is a read,
 * and the clients need it to label what they show. Only `admin` can act on it.
 */
export function useSeasonContext(client: ApiClient, enabled = true) {
  return useQuery({
    queryKey: seasonsKey,
    queryFn: () => client.get<SeasonContext>('/api/v1/seasons'),
    enabled,
    // A season changes at most once a year. Refetching it on every window focus
    // would be pure noise.
    staleTime: 5 * 60_000,
  });
}

/**
 * What closing `year` would do, computed with zero writes.
 *
 * Deliberately NOT cached across opens of the confirmation dialog: it counts
 * open trips and silent devices, and a stale copy would tell the admin the
 * field is drained when it is not.
 */
export function useSeasonPreflight(client: ApiClient, year: number | null) {
  return useQuery({
    queryKey: seasonPreflightKey(year ?? 0),
    queryFn: () => client.get<SeasonPreflight>(`/api/v1/seasons/${year}/preflight`),
    enabled: year !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Close a season.
 *
 * Invalidates EVERYTHING on success rather than a curated list. Closing
 * re-scopes every aggregate in the product — depot stock, field tallies,
 * reports, dashboards — and it happens once a year, so being exhaustive costs
 * one refetch storm a year and being selective risks a screen showing last
 * season's numbers under this season's heading.
 */
export function useCloseSeason(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CloseSeasonDto) =>
      client.post<CloseSeasonResult>('/api/v1/seasons/close', dto),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
