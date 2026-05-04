import type { ApiClient } from '@strawboss/api';
import type {
  SyncPushRequest,
  SyncResponse,
  RegisterLoadDto,
  RegisterLoadResult,
} from '@strawboss/types';
import type { SyncQueueEntry } from '../db/sync-queue-repo';

export interface PushResult {
  count: number;
  errors: string[];
  completedIds: number[];
  failedEntries: Array<{ id: number; error: string }>;
}

/** Sync queue entityTypes that bypass /sync/push and target a dedicated endpoint. */
const DIRECT_ENDPOINT_TYPES = new Set(['register_load']);

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
 * Send a single `register_load` queue entry to the dedicated endpoint.
 * Idempotent on the payload's `idempotencyKey` server-side.
 */
async function sendRegisterLoad(
  entry: SyncQueueEntry,
  apiClient: ApiClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let payload: RegisterLoadDto;
  try {
    payload = JSON.parse(entry.payload) as RegisterLoadDto;
  } catch (err) {
    return {
      ok: false,
      error: `register_load: payload not parsable (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }
  try {
    await apiClient.post<RegisterLoadResult>(
      '/api/v1/trips/register-load',
      payload,
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Push pending mutations from the sync queue to the server.
 *
 * Standard table mutations are bundled into a single /sync/push call.
 * Special entityTypes (currently only `register_load`) are routed one by
 * one to their dedicated endpoint — they don't fit the generic
 * "table/recordId/action" sync envelope.
 */
export async function pushMutations(
  entries: SyncQueueEntry[],
  apiClient: ApiClient,
): Promise<PushResult> {
  if (entries.length === 0) {
    return { count: 0, errors: [], completedIds: [], failedEntries: [] };
  }

  const completedIds: number[] = [];
  const failedEntries: Array<{ id: number; error: string }> = [];
  const errors: string[] = [];

  const directEntries = entries.filter((e) => DIRECT_ENDPOINT_TYPES.has(e.entity_type));
  const tableEntries = entries.filter((e) => !DIRECT_ENDPOINT_TYPES.has(e.entity_type));

  for (const entry of directEntries) {
    if (entry.entity_type === 'register_load') {
      const res = await sendRegisterLoad(entry, apiClient);
      if (res.ok) {
        completedIds.push(entry.id);
      } else {
        errors.push(res.error);
        failedEntries.push({ id: entry.id, error: res.error });
      }
    }
  }

  if (tableEntries.length > 0) {
    const mutations = tableEntries.map((entry) => ({
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

      for (let i = 0; i < response.results.length && i < tableEntries.length; i++) {
        const entry = tableEntries[i];
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

      for (let i = response.results.length; i < tableEntries.length; i++) {
        const errorMsg = `No server response for entry ${tableEntries[i].entity_type}/${tableEntries[i].entity_id}`;
        errors.push(errorMsg);
        failedEntries.push({ id: tableEntries[i].id, error: errorMsg });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Push failed';
      errors.push(message);
      for (const e of tableEntries) {
        failedEntries.push({ id: e.id, error: message });
      }
    }
  }

  return {
    count: completedIds.length,
    errors,
    completedIds,
    failedEntries,
  };
}
