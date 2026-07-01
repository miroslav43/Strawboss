import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../client/api-client.js';
import type { OutboundMessageRecord } from '@strawboss/types';
import { queryKeys } from '../queries/query-keys.js';

export interface MessageFilters {
  channel?: 'email' | 'sms';
  status?: 'pending' | 'sent' | 'failed' | 'delivered';
}

export function useMessages(client: ApiClient, filters?: MessageFilters) {
  return useQuery({
    queryKey: queryKeys.messages.list(filters as Record<string, unknown> | undefined),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.channel) params.set('channel', filters.channel);
      if (filters?.status) params.set('status', filters.status);
      const qs = params.toString();
      return client.get<OutboundMessageRecord[]>(`/api/v1/messages${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 15_000,
  });
}

export function useRetryMessage(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.post(`/api/v1/messages/${id}/retry`, {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.messages.all });
    },
  });
}
