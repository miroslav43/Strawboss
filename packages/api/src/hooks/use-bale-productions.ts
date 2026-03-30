import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BaleProduction } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export interface BaleProductionFilters {
  operatorId?: string;
  parcelId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildQuery(filters: BaleProductionFilters): string {
  const params = new URLSearchParams();
  if (filters.operatorId) params.set('operatorId', filters.operatorId);
  if (filters.parcelId) params.set('parcelId', filters.parcelId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `/api/v1/bale-productions?${qs}` : '/api/v1/bale-productions';
}

export function useBaleProductions(client: ApiClient, filters?: BaleProductionFilters) {
  return useQuery({
    queryKey: filters?.operatorId
      ? queryKeys.baleProductions.byOperator(filters.operatorId)
      : queryKeys.baleProductions.list(filters as Record<string, unknown>),
    queryFn: () => client.get<BaleProduction[]>(buildQuery(filters ?? {})),
  });
}

export function useCreateBaleProduction(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<BaleProduction>) =>
      client.post<BaleProduction>('/api/v1/bale-productions', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.baleProductions.all });
    },
  });
}
