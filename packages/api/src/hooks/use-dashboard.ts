import { useQuery } from '@tanstack/react-query';
import type {
  DashboardOverview,
  ProductionReport,
  CostReport,
  AntiFraudReport,
} from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export function useDashboardOverview(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(),
    queryFn: () => client.get<DashboardOverview>('/api/v1/dashboard/overview'),
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

export function useCostReport(client: ApiClient, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.dashboard.costs(filters),
    queryFn: () => {
      const params = filters ? `?${new URLSearchParams(filters as Record<string, string>)}` : '';
      return client.get<CostReport[]>(`/api/v1/dashboard/costs${params}`);
    },
  });
}

export function useAntiFraudReport(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.dashboard.antiFraud(),
    queryFn: () => client.get<AntiFraudReport>('/api/v1/dashboard/anti-fraud'),
  });
}
