import type { ApiClient } from '@strawboss/api';
import type { SyncPushRequest, SyncResponse } from '@strawboss/types';
import type { SyncQueueEntry } from '../db/sync-queue-repo';

export interface PushResult {
  count: number;
  errors: string[];
  completedIds: number[];
  failedEntries: Array<{ id: number; error: string }>;
}

/**
 * Push pending mutations from the sync queue to the server.
 * Converts local queue entries to the SyncPushRequest format and sends them.
 */
export async function pushMutations(
  entries: SyncQueueEntry[],
  apiClient: ApiClient,
): Promise<PushResult> {
  if (entries.length === 0) {
    return { count: 0, errors: [], completedIds: [], failedEntries: [] };
  }

  const mutations = entries.map((entry) => ({
    table: entry.entity_type,
    recordId: entry.entity_id,
    action: entry.action as 'insert' | 'update' | 'delete',
    data: JSON.parse(entry.payload) as Record<string, unknown>,
    clientId: entry.entity_id,
    clientVersion: 0,
    idempotencyKey: entry.idempotency_key,
  }));

  const request: SyncPushRequest = { mutations };

  try {
    const response = await apiClient.post<SyncResponse>('/api/v1/sync/push', request);

    const completedIds: number[] = [];
    const failedEntries: Array<{ id: number; error: string }> = [];
    const errors: string[] = [];

    for (let i = 0; i < response.results.length && i < entries.length; i++) {
      const entry = entries[i];
      const result = response.results[i];

      if (result.status === 'applied' || result.status === 'skipped') {
        completedIds.push(entry.id);
      } else if (result.status === 'conflict') {
        const errorMsg = `${result.status}: ${result.table}/${result.recordId}`;
        errors.push(errorMsg);
        failedEntries.push({ id: entry.id, error: errorMsg });
      }
    }

    // Mark entries with no server response as failed (server truncated)
    for (let i = response.results.length; i < entries.length; i++) {
      const errorMsg = `No server response for entry ${entries[i].entity_type}/${entries[i].entity_id}`;
      errors.push(errorMsg);
      failedEntries.push({ id: entries[i].id, error: errorMsg });
    }

    return {
      count: completedIds.length,
      errors,
      completedIds,
      failedEntries,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Push failed';
    return {
      count: 0,
      errors: [message],
      completedIds: [],
      failedEntries: entries.map((e) => ({ id: e.id, error: message })),
    };
  }
}
