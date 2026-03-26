import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SyncPushRequest, SyncPullRequest, SyncResponse } from '@strawboss/types';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

export interface SyncStatus {
  lastSyncedAt: string | null;
  pendingMutations: number;
  isOnline: boolean;
}

export function useSyncStatus(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.sync.status(),
    queryFn: () => client.get<SyncStatus>('/api/v1/sync/status'),
  });
}

export function useSyncPush(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SyncPushRequest) =>
      client.post<SyncResponse>('/api/v1/sync/push', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.status() });
    },
  });
}

export function useSyncPull(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SyncPullRequest) =>
      client.post<SyncResponse>('/api/v1/sync/pull', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.status() });
    },
  });
}
