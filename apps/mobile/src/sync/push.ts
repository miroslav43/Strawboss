import type { ApiClient } from '@strawboss/api';
import type { SyncPushRequest, SyncResponse } from '@strawboss/types';
import type { SyncQueueEntry } from '../db/sync-queue-repo';

export interface PushResult {
  count: number;
  errors: string[];
  completedIds: number[];
  failedEntries: Array<{ id: number; error: string }>;
}

/** Columns stored as INTEGER 0/1 locally but declared BOOLEAN in Postgres. */
const BOOLEAN_FIELDS_BY_TABLE: Record<string, readonly string[]> = {
  fuel_logs: ['is_full_tank'],
};

/**
 * Coerce legacy payload values so they match the server schema. Older mobile
 * builds stored 0/1 for boolean columns (SQLite convention); Postgres rejects
 * an implicit int→boolean cast during INSERT, so we normalize here.
 */
function normalizePayload(
  table: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const booleanFields = BOOLEAN_FIELDS_BY_TABLE[table];
  if (!booleanFields) return payload;

  const next = { ...payload };
  for (const field of booleanFields) {
    const v = next[field];
    if (typeof v === 'number') next[field] = v !== 0;
    else if (v === '0' || v === 'false') next[field] = false;
    else if (v === '1' || v === 'true') next[field] = true;
  }
  return next;
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
    data: normalizePayload(
      entry.entity_type,
      JSON.parse(entry.payload) as Record<string, unknown>,
    ),
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
        const errorMsg = `conflict: ${result.table}/${result.recordId}`;
        errors.push(errorMsg);
        failedEntries.push({ id: entry.id, error: errorMsg });
      } else if (result.status === 'failed') {
        const errorMsg = `server rejected ${result.table}/${result.recordId}: ${result.error ?? 'unknown error'}`;
        errors.push(errorMsg);
        failedEntries.push({ id: entry.id, error: errorMsg });
      } else {
        const errorMsg = `Unexpected sync status: ${String((result as { status?: unknown })?.status)} (${result?.table ?? '?'}/${result?.recordId ?? '?'})`;
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
