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

export interface SuperAdminMessageFilters extends MessageFilters {
  /** Restrict to messages claimed by one gateway device. */
  deviceId?: string;
}

/**
 * Super-admin global outbox monitor — NOT org-scoped, so NULL-org rows
 * (e.g. gateway_test from an unassigned gateway) are included.
 */
export function useSuperAdminMessages(client: ApiClient, filters?: SuperAdminMessageFilters) {
  return useQuery({
    queryKey: queryKeys.messages.superAdminList(filters as Record<string, unknown> | undefined),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.channel) params.set('channel', filters.channel);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.deviceId) params.set('deviceId', filters.deviceId);
      const qs = params.toString();
      return client.get<OutboundMessageRecord[]>(
        `/api/v1/super-admin/messages${qs ? `?${qs}` : ''}`,
      );
    },
    refetchInterval: 15_000,
  });
}

export function useRetrySuperAdminMessage(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.post(`/api/v1/super-admin/messages/${id}/retry`, {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.messages.all });
    },
  });
}

/** Outbox history for one gateway device (messages it claimed). */
export function useDeviceMessages(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.devices.messages(id),
    queryFn: () =>
      client.get<OutboundMessageRecord[]>(`/api/v1/super-admin/devices/${id}/messages`),
    enabled: !!id,
    refetchInterval: 15_000,
  });
}
