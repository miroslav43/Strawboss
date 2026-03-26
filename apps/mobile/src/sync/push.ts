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

    for (const result of response.results) {
      const matchedEntry = entries.find((e) => e.entity_id === result.recordId);
      if (!matchedEntry) continue;

      if (result.status === 'applied') {
        completedIds.push(matchedEntry.id);
      } else if (result.status === 'conflict' || result.status === 'skipped') {
        const errorMsg = `${result.status}: ${result.table}/${result.recordId}`;
        errors.push(errorMsg);
        failedEntries.push({ id: matchedEntry.id, error: errorMsg });
      }
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
