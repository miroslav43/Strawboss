import type { ApiClient } from '@strawboss/api';
import type {
  SyncPushRequest,
  SyncResponse,
  RegisterLoadDto,
  RegisterLoadResult,
} from '@strawboss/types';
import * as FileSystem from 'expo-file-system/legacy';
import type { SyncQueueEntry } from '../db/sync-queue-repo';
import type { TripsRepo } from '../db/trips-repo';
import { uploadCmrScan, deleteLocalCmrPdf, type CmrScanPayload } from '../lib/cmrScanUpload';

export interface PushResult {
  count: number;
  errors: string[];
  completedIds: number[];
  failedEntries: Array<{ id: number; error: string }>;
}

/** Sync queue entityTypes that bypass /sync/push and target a dedicated endpoint. */
const DIRECT_ENDPOINT_TYPES = new Set([
  'register_load',
  'trip_transition',
  // Geofence-maker writes — the parcels & delivery_destinations REST endpoints
  // do extra server-side work (org scoping, FarmTrack registration) that the
  // generic /sync/push handler does not perform, so retries go directly to the
  // REST endpoint with the original payload.
  'parcel_create',
  'delivery_destination_create',
  // Scanned paper CMR: a multipart file upload to its own endpoint, not a row in
  // any syncable table. Without it here, /sync/push would try to INSERT INTO
  // cmr_scan and fail forever.
  'cmr_scan',
]);

/**
 * Parent-first ordering for the /sync/push batch (M21).
 * Entities listed earlier in this array are sent before entities listed later,
 * so the server can satisfy FK constraints (trips before bale_loads etc.).
 * Entity types not listed here sort after all known types.
 */
const ENTITY_ORDER: readonly string[] = [
  'trips',
  'operations',
  'bale_productions',
  'fuel_logs',
  'consumable_logs',
  'bale_loads',
  'task_assignments',
];

function entitySortIndex(entityType: string): number {
  const idx = ENTITY_ORDER.indexOf(entityType);
  return idx === -1 ? ENTITY_ORDER.length : idx;
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
    await apiClient.post<RegisterLoadResult>('/api/v1/trips/register-load', payload);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The idempotency_key of the register_load this CMR was queued alongside, if any. */
function registerLoadKeyOf(entry: SyncQueueEntry): string | undefined {
  try {
    return (JSON.parse(entry.payload) as CmrScanPayload).registerLoadIdempotencyKey;
  } catch {
    return undefined;
  }
}

/**
 * Send a queued `cmr_scan` entry: the PDF the loader built on-device at the end of
 * an auxiliary load, waiting on the filesystem for signal.
 *
 * Idempotent server-side by replacement — re-sending supersedes the previous scan
 * rather than duplicating it, so a retry after an ambiguous failure is safe.
 */
// Takes no ApiClient: uploadCmrScan posts multipart through the mobileApiClient
// singleton, the same way uploadReceipt does from SyncManager.
async function sendCmrScan(
  entry: SyncQueueEntry,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let payload: CmrScanPayload;
  try {
    payload = JSON.parse(entry.payload) as CmrScanPayload;
  } catch (err) {
    return {
      ok: false,
      error: `cmr_scan: payload not parsable (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  // Checked before the upload, so a vanished PDF (app data cleared) costs a stat()
  // per cycle rather than a network round-trip. It stays in the failed queue, where
  // the operator sees it in the profile and can re-scan.
  const info = await FileSystem.getInfoAsync(payload.localPdfUri);
  if (!info.exists) {
    return { ok: false, error: 'cmr_scan: PDF file is gone — re-scan the CMR' };
  }

  try {
    await uploadCmrScan(payload.tripId, payload.localPdfUri, payload.pageCount);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Only reclaim the space once the server has it.
  await deleteLocalCmrPdf(payload.localPdfUri);
  return { ok: true };
}

/**
 * FM-1: Payload shape for a queued trip_transition entry.
 */
export interface TripTransitionPayload {
  transition: string;
  tripId: string;
  body: Record<string, unknown>;
}

/**
 * Send a single direct-REST entry to its endpoint. Idempotency is delegated
 * to the server (parcels uses `code` UNIQUE within org; delivery_destinations
 * uses `code` UNIQUE within org as well — replays surface as 409 which we
 * treat as success because the original POST already created the row).
 */
async function sendDirectRestCreate(
  entry: SyncQueueEntry,
  apiClient: ApiClient,
  endpoint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(entry.payload) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: `${entry.entity_type}: payload not parsable (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }
  try {
    await apiClient.post(endpoint, payload);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The unique constraint on (code, organization_id) means a successful
    // earlier retry shows up as 409 / "already exists" / "duplicate key" on
    // replay. Treat those as idempotent success so the queue drains.
    if (
      /already exists/i.test(message) ||
      /duplicate key/i.test(message) ||
      /conflict/i.test(message) ||
      /\b409\b/.test(message)
    ) {
      return { ok: true };
    }
    return { ok: false, error: message };
  }
}

/**
 * FM-1: Send a single trip_transition entry to its dedicated REST endpoint.
 * Uses the `postTolerant` approach: if the server says the trip is already
 * in the target state ("not allowed from status"), treat it as success.
 * This makes the operation safe to replay on reconnect.
 */
async function sendTripTransition(
  entry: SyncQueueEntry,
  apiClient: ApiClient,
  tripsRepo?: TripsRepo,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let payload: TripTransitionPayload;
  try {
    payload = JSON.parse(entry.payload) as TripTransitionPayload;
  } catch (err) {
    return {
      ok: false,
      error: `trip_transition: payload not parsable (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }

  const { transition, tripId, body } = payload;
  const url = `/api/v1/trips/${tripId}/${transition}`;

  try {
    await apiClient.post(url, body);
    // Clear the pending-transition flag in local SQLite so the UI badge disappears.
    if (tripsRepo) {
      await tripsRepo.clearPendingTransitionFlag(tripId);
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "not allowed from status" means a previous retry already applied this
    // transition on the server — treat it as idempotent success.
    if (/not allowed from status/i.test(message)) {
      if (tripsRepo) {
        await tripsRepo.clearPendingTransitionFlag(tripId);
      }
      return { ok: true };
    }
    return { ok: false, error: message };
  }
}

/**
 * Push pending mutations from the sync queue to the server.
 *
 * Standard table mutations are bundled into a single /sync/push call.
 * Special entityTypes (register_load, trip_transition) are routed one by
 * one to their dedicated endpoint — they don't fit the generic
 * "table/recordId/action" sync envelope.
 *
 * trip_transition entries are sent in (created_at ASC, id ASC) order (guaranteed
 * by dequeue) so multi-step transitions enqueued in the same second — e.g. the
 * delivery flow's start-delivery → confirm-delivery → complete — arrive in the
 * correct sequence. They are awaited one at a time, so each server-side step is
 * applied before the next is sent.
 */
export async function pushMutations(
  entries: SyncQueueEntry[],
  apiClient: ApiClient,
  tripsRepo?: TripsRepo,
): Promise<PushResult> {
  if (entries.length === 0) {
    return { count: 0, errors: [], completedIds: [], failedEntries: [] };
  }

  const completedIds: number[] = [];
  const failedEntries: Array<{ id: number; error: string }> = [];
  const errors: string[] = [];

  const directEntries = entries.filter((e) => DIRECT_ENDPOINT_TYPES.has(e.entity_type));
  const tableEntries = entries.filter((e) => !DIRECT_ENDPOINT_TYPES.has(e.entity_type));

  // Multi-step transitions for the SAME trip (the delivery flow enqueues
  // start-delivery → confirm-delivery → complete) must be applied in order. If
  // one fails this cycle, sending the next would reach the server while it's
  // still in the earlier state, and sendTripTransition treats the resulting
  // "not allowed from status" as success — silently dropping the dependent
  // transition and stranding the trip. So once a trip's transition fails this
  // cycle, we DEFER (fail without sending) the rest of that trip's transitions.
  // They fail together with the predecessor and recover together — replayed in
  // order on the next retry (manual "retry failed", or a re-confirm which resets
  // failed rows to pending via enqueueOrUpdate). entity_id is the trip id for
  // trip_transition entries.
  const blockedTrips = new Set<string>();
  // A cmr_scan is enqueued right after the register_load for the same aux load. The
  // scan doesn't strictly depend on it (the aux trip row already exists server-side,
  // created when the dispatcher assigned the loader), but sending a CMR for a load
  // that failed to register this cycle just muddies the picture — so defer it and
  // let the pair recover together on the next retry.
  const failedRegisterLoads = new Set<string>();
  for (const entry of directEntries) {
    if (entry.entity_type === 'trip_transition' && blockedTrips.has(entry.entity_id)) {
      const msg = `deferred: an earlier transition for trip ${entry.entity_id} failed this sync cycle`;
      errors.push(msg);
      failedEntries.push({ id: entry.id, error: msg });
      continue;
    }

    let res: { ok: true } | { ok: false; error: string };
    if (entry.entity_type === 'register_load') {
      res = await sendRegisterLoad(entry, apiClient);
    } else if (entry.entity_type === 'cmr_scan') {
      const dependsOn = registerLoadKeyOf(entry);
      if (dependsOn && failedRegisterLoads.has(dependsOn)) {
        const msg = `deferred: the register_load for this CMR failed this sync cycle`;
        errors.push(msg);
        failedEntries.push({ id: entry.id, error: msg });
        continue;
      }
      res = await sendCmrScan(entry);
    } else if (entry.entity_type === 'trip_transition') {
      res = await sendTripTransition(entry, apiClient, tripsRepo);
    } else if (entry.entity_type === 'parcel_create') {
      res = await sendDirectRestCreate(entry, apiClient, '/api/v1/parcels');
    } else if (entry.entity_type === 'delivery_destination_create') {
      res = await sendDirectRestCreate(entry, apiClient, '/api/v1/delivery-destinations');
    } else {
      // Should not happen — DIRECT_ENDPOINT_TYPES is the authoritative list.
      res = { ok: false, error: `Unknown direct endpoint type: ${entry.entity_type}` };
    }
    if (res.ok) {
      completedIds.push(entry.id);
    } else {
      errors.push(res.error);
      failedEntries.push({ id: entry.id, error: res.error });
      // Block later transitions for the same trip so they are not applied out of
      // order (and silently consumed) before this one succeeds.
      if (entry.entity_type === 'trip_transition') {
        blockedTrips.add(entry.entity_id);
      }
      if (entry.entity_type === 'register_load') {
        failedRegisterLoads.add(entry.idempotency_key);
      }
    }
  }

  if (tableEntries.length > 0) {
    // Sort entries so parent entities (trips, operations) precede children
    // (bale_loads, fuel_logs, etc.) — satisfies server-side FK constraints (M21).
    // Within the same entity type, preserve original created_at ASC order from dequeue.
    tableEntries.sort((a, b) => entitySortIndex(a.entity_type) - entitySortIndex(b.entity_type));

    const mutations = tableEntries.map((entry) => ({
      table: entry.entity_type,
      recordId: entry.entity_id,
      action: entry.action as 'insert' | 'update' | 'delete',
      data: normalizePayload(
        entry.entity_type,
        JSON.parse(entry.payload) as Record<string, unknown>,
      ),
      clientId: entry.entity_id,
      // Real per-entry content version (bumped by updatePayload/
      // enqueueOrUpdate/repairAndRequeue on every corrected re-send) — a
      // hardcoded 0 here would let a corrected retry match the
      // sync_idempotency row cached from an earlier, already-applied
      // version of this entity_id and be silently skipped as a duplicate.
      clientVersion: entry.client_version ?? 0,
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
