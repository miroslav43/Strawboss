import type { ApiClient } from '@strawboss/api';
import type { SyncPullRequest, SyncResponse, SyncResult } from '@strawboss/types';

export interface PullResult {
  count: number;
  errors: string[];
  updates: SyncResult[];
  serverTime: string | null;
}

/**
 * Pull delta updates from the server.
 * Sends the last known version for each table and receives new/updated records.
 */
export async function pullUpdates(
  lastVersions: Record<string, number>,
  apiClient: ApiClient,
): Promise<PullResult> {
  try {
    const request: SyncPullRequest = { tables: lastVersions };
    const response = await apiClient.post<SyncResponse>('/api/v1/sync/pull', request);

    return {
      count: response.results.length,
      errors: [],
      updates: response.results,
      serverTime: response.serverTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pull failed';
    return {
      count: 0,
      errors: [message],
      updates: [],
      serverTime: null,
    };
  }
}
