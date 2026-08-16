import { useQuery } from '@tanstack/react-query';
import type {
  DashboardOverview,
  ProductionReport,
  CostReport,
  AntiFraudReport,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

/** Drops empty values so an absent `season` sends no parameter at all. */
function toQueryString(filters?: Record<string, unknown>): string {
  if (!filters) return '';
  const entries = Object.entries(filters).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}`;
}

export function useDashboardOverview(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(filters),
    queryFn: () =>
      client.get<DashboardOverview>(`/api/v1/dashboard/overview${toQueryString(filters)}`),
  });
}

export function useProductionReport(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.dashboard.production(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<ProductionReport[]>(`/api/v1/dashboard/production${params}`);
    },
  });
}

export interface CostReportOptions {
  enabled?: boolean;
}

export function useCostReport(
  client: ApiClient,
  filters?: Record<string, unknown>,
  options?: CostReportOptions,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.costs(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<CostReport[]>(`/api/v1/dashboard/costs${params}`);
    },
    enabled: options?.enabled,
  });
}

export interface TrendingDay {
  date: string;
  bales: number;
  tripsCompleted: number;
}

export function useDashboardTrending(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.dashboard.trending(),
    queryFn: () => client.get<TrendingDay[]>('/api/v1/dashboard/trending'),
  });
}

export function useAntiFraudReport(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.dashboard.antiFraud(filters),
    queryFn: () =>
      client.get<AntiFraudReport>(`/api/v1/dashboard/anti-fraud${toQueryString(filters)}`),
  });
}
