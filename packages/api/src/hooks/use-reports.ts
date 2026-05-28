import { useQuery } from '@tanstack/react-query';
import type {
  FarmReport,
  DepotReport,
  ReportTimelinePoint,
  TruckDistanceRow,
  TruckDistanceSummary,
  ConnectedHoursGroupBy,
  ConnectedHoursReport,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

function toQueryString(filters?: Record<string, unknown>): string {
  if (!filters) return '';
  const entries = Object.entries(filters).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${params.toString()}`;
}

export interface ReportQueryOptions {
  enabled?: boolean;
}

export function useFarmReports(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: ReportQueryOptions,
) {
  return useQuery({
    queryKey: queryKeys.reports.farms(filters),
    queryFn: () => client.get<FarmReport[]>(`/api/v1/reports/farms${toQueryString(filters)}`),
    enabled: options?.enabled,
  });
}

export function useDepotReports(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: ReportQueryOptions,
) {
  return useQuery({
    queryKey: queryKeys.reports.depots(filters),
    queryFn: () => client.get<DepotReport[]>(`/api/v1/reports/depots${toQueryString(filters)}`),
    enabled: options?.enabled,
  });
}

export function useReportTimeline(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: ReportQueryOptions,
) {
  return useQuery({
    queryKey: queryKeys.reports.timeline(filters),
    queryFn: () =>
      client.get<ReportTimelinePoint[]>(`/api/v1/reports/timeline${toQueryString(filters)}`),
    enabled: options?.enabled,
  });
}

export interface TruckDistanceFilters extends Record<string, unknown> {
  from: string;
  to: string;
  machineId?: string;
}

/**
 * T18 — bulk per-truck-per-day distance report, derived from machine_location_events
 * with noise capping. Returns one row per (truck, day) in the range.
 */
export function useTruckDistanceReport(
  client: ApiClient,
  filters: TruckDistanceFilters,
  options?: ReportQueryOptions,
) {
  return useQuery({
    queryKey: queryKeys.reports.truckDistance(filters),
    queryFn: () =>
      client.get<TruckDistanceRow[]>(`/api/v1/reports/truck-distance${toQueryString(filters)}`),
    enabled: (options?.enabled ?? true) && !!filters.from && !!filters.to,
  });
}

/**
 * T18 — "today / this week" km summary per truck for the Machines admin page.
 */
export function useTruckDistanceSummary(client: ApiClient, options?: ReportQueryOptions) {
  return useQuery({
    queryKey: queryKeys.reports.truckDistanceSummary(),
    queryFn: () => client.get<TruckDistanceSummary[]>('/api/v1/reports/truck-distance/summary'),
    enabled: options?.enabled,
  });
}

export interface ConnectedHoursFilters extends Record<string, unknown> {
  from: string;
  to: string;
  groupBy: ConnectedHoursGroupBy;
}

/**
 * Plan A T4 — connected hours per user per day/week/month.
 * Surfaces in the admin Reports page as the "Connected hours" tab.
 */
export function useUserConnectedHoursReport(
  client: ApiClient,
  filters: ConnectedHoursFilters,
  options?: ReportQueryOptions,
) {
  return useQuery({
    queryKey: queryKeys.reports.userConnectedHours(filters),
    queryFn: () =>
      client.get<ConnectedHoursReport>(
        `/api/v1/reports/user-connected-hours${toQueryString(filters)}`,
      ),
    enabled: (options?.enabled ?? true) && !!filters.from && !!filters.to,
  });
}
