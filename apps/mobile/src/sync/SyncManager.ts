import type { ApiClient } from '@strawboss/api';
import type { SyncResult as SyncResultDto, SyncTombstone } from '@strawboss/types';
import { mobileLogger } from '../lib/logger';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo, type LocalTrip } from '../db/trips-repo';
import { BaleProductionsRepo, type LocalBaleProduction } from '../db/bale-productions-repo';
import { FuelLogsRepo, type LocalFuelLog } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo, type LocalConsumableLog } from '../db/consumable-logs-repo';
import { BaleLoadsRepo, type LocalBaleLoad } from '../db/bale-loads-repo';
import { TaskAssignmentsRepo, type LocalTaskAssignment } from '../db/task-assignments-repo';
import { ParcelsRepo, type LocalParcel } from '../db/parcels-repo';
import { SyncCursorsRepo } from '../db/sync-cursors-repo';
import { pushMutations } from './push';
import { pullUpdates } from './pull';
import { mergeRecords } from './conflict';
import { notifyDivergentFields } from './conflict-notify';
import { uploadTodayMobileLogs } from './mobile-log-upload';
import { uploadReceipt } from '../lib/receiptUpload';

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

/**
 * SyncManager orchestrates the push/pull synchronization cycle.
 *
 * Push: sends pending local mutations to the server.
 * Pull: fetches delta updates from server and merges into local SQLite.
 */
export class SyncManager {
  /**
   * Mutex flag: true while a sync cycle is actively running.
   * Prevents uploadPendingReceipts (which reads pending entries) from racing
   * with push() (which marks the same entries in_flight and processes them).
   */
  private syncInProgress = false;

  constructor(
    private syncQueueRepo: SyncQueueRepo,
    private tripsRepo: TripsRepo,
    private apiClient: ApiClient,
    private baleProductionsRepo?: BaleProductionsRepo,
    private fuelLogsRepo?: FuelLogsRepo,
    private consumableLogsRepo?: ConsumableLogsRepo,
    private baleLoadsRepo?: BaleLoadsRepo,
    private taskAssignmentsRepo?: TaskAssignmentsRepo,
    private parcelsRepo?: ParcelsRepo,
    private syncCursorsRepo?: SyncCursorsRepo,
  ) {}

  /**
   * Run a full sync cycle: push pending changes, then pull updates.
   */
  async sync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      mobileLogger.warn('Sync cycle skipped — previous cycle still in progress');
      return { pushed: 0, pulled: 0, errors: [] };
    }
    this.syncInProgress = true;
    mobileLogger.flow('Sync cycle started');

    try {
      // Reset any entries stuck in 'in_flight' from a previous interrupted sync
      await this.syncQueueRepo.resetInFlight();

      await this.syncQueueRepo.normalizeLegacyEntityTypes();

      // Legacy entries produced with Math.random() IDs can never succeed on
      // the server (id columns are UUID). Flag them so we don't keep retrying.
      const invalidated = await this.syncQueueRepo.markInvalidUuidsAsFailed();
      if (invalidated > 0) {
        mobileLogger.flow('Sync: flagged legacy entries with invalid UUIDs', {
          count: invalidated,
        });
      }

      // Single purgeCompleted call per cycle (M32 — was duplicated in push() too).
      await this.syncQueueRepo.purgeCompleted();

      // Best-effort: upload receipt photos for rows that were saved offline or
      // whose initial upload attempt failed. Any failure here is non-fatal —
      // the mutation still pushes, just without a photo URL.
      // uploadPendingReceipts runs BEFORE push() so it cannot race with
      // push()'s in_flight marking (M20 — syncInProgress guards concurrent
      // external calls; the sequential order guards within one cycle).
      await this.uploadPendingReceipts().catch((err) => {
        mobileLogger.error('Pre-push receipt upload pass failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });

      const pushResult = await this.push();
      const pullResult = await this.pull();

      const errors = [...pushResult.errors, ...pullResult.errors];
      const result: SyncResult = {
        pushed: pushResult.count,
        pulled: pullResult.count,
        errors,
      };

      if (errors.length === 0) {
        void uploadTodayMobileLogs(this.apiClient).catch(() => {
          /* best-effort log upload */
        });
      }

      // Prune permanently-failed entries that are too old to recover (M12).
      await this.syncQueueRepo.purgeStale().catch(() => {
        /* non-fatal — stale rows stay until next cycle */
      });

      mobileLogger.flow('Sync cycle finished', {
        pushed: result.pushed,
        pulled: result.pulled,
        errorCount: result.errors.length,
      });

      return result;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Push all pending mutations to the server.
   */
  private async push(): Promise<{ count: number; errors: string[] }> {
    let batchIds: number[] = [];
    try {
      const entries = await this.syncQueueRepo.dequeue(50);
      if (entries.length === 0) {
        return { count: 0, errors: [] };
      }

      batchIds = entries.map((e) => e.id);
      await this.syncQueueRepo.markInFlight(batchIds);

      const result = await pushMutations(entries, this.apiClient, this.tripsRepo);

      if (result.completedIds.length > 0) {
        await this.syncQueueRepo.markCompleted(result.completedIds);
      }

      for (const failed of result.failedEntries) {
        await this.syncQueueRepo.markFailed(failed.id, failed.error);
      }

      const handled = new Set([...result.completedIds, ...result.failedEntries.map((f) => f.id)]);
      for (const id of batchIds) {
        if (!handled.has(id)) {
          await this.syncQueueRepo.markFailed(
            id,
            'Răspuns incomplet de la server pentru această înregistrare',
          );
        }
      }

      // purgeCompleted() is called once at the start of sync(); no need to
      // repeat it here (M32 — removed duplicate call).

      return { count: result.count, errors: result.errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Push failed';
      for (const id of batchIds) {
        await this.syncQueueRepo.markFailed(id, message);
      }
      return { count: 0, errors: [message] };
    }
  }

  /**
   * Pull delta updates from the server and merge into local storage.
   */
  private async pull(): Promise<{ count: number; errors: string[] }> {
    try {
      const lastVersions = await this.getLastVersions();

      const result = await pullUpdates(lastVersions, this.apiClient);

      if (result.updates.length === 0 && result.deletions.length === 0) {
        return { count: 0, errors: result.errors };
      }

      // Track the highest server_version we observed per table so we can
      // advance the persisted cursor even when the only news for a table is
      // a tombstone (which DELETEs the local row, dropping MAX(server_version)
      // back below the tombstone's version).
      const maxByTable: Record<string, number> = {};
      const bumpMax = (table: string, version: number) => {
        if (!Number.isFinite(version)) return;
        const current = maxByTable[table];
        if (current === undefined || version > current) maxByTable[table] = version;
      };

      let applied = 0;
      for (const update of result.updates) {
        try {
          await this.applyUpdate(update);
          bumpMax(update.table, update.serverVersion);
          applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Apply failed';
          result.errors.push(`Failed to apply ${update.table}/${update.recordId}: ${msg}`);
        }
      }

      for (const tomb of result.deletions) {
        try {
          await this.applyTombstone(tomb);
          bumpMax(tomb.table, tomb.serverVersion);
          applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Tombstone apply failed';
          result.errors.push(`Failed to tombstone ${tomb.table}/${tomb.recordId}: ${msg}`);
        }
      }

      if (this.syncCursorsRepo) {
        for (const [table, version] of Object.entries(maxByTable)) {
          try {
            await this.syncCursorsRepo.upsert(table, version);
          } catch (err) {
            mobileLogger.warn('Sync cursor upsert failed (non-fatal)', {
              table,
              version,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return { count: applied, errors: result.errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pull failed';
      return { count: 0, errors: [message] };
    }
  }

  /**
   * Get last known server version for each table.
   *
   * Prefers the persisted cursor (sync_cursors) when present, falling back
   * to per-table `MAX(server_version)`. Bootstrapping path for existing
   * installs: cursor is null on first run → MAX scan seeds the cursor on
   * the next pull (see `pull()` above).
   */
  private async getLastVersions(): Promise<Record<string, number>> {
    const versions: Record<string, number> = {
      trips: 0,
      operations: 0,
      bale_productions: 0,
      fuel_logs: 0,
      consumable_logs: 0,
      bale_loads: 0,
      task_assignments: 0,
      // FM-13: request parcel geometry updates on every pull (no server_version
      // column on parcels table — always send 0 to get all assigned parcels)
      parcels: 0,
    };

    const resolveVersion = async (
      table: string,
      fallback: () => Promise<number>,
    ): Promise<number> => {
      if (this.syncCursorsRepo) {
        try {
          const persisted = await this.syncCursorsRepo.get(table);
          if (persisted !== null) return persisted;
        } catch {
          // Cursor table read failure is non-fatal — fall through to scan.
        }
      }
      try {
        return await fallback();
      } catch {
        return 0;
      }
    };

    versions['trips'] = await resolveVersion('trips', () => this.tripsRepo.getMaxServerVersion());

    if (this.baleProductionsRepo) {
      versions['bale_productions'] = await resolveVersion('bale_productions', () =>
        this.baleProductionsRepo!.getMaxServerVersion(),
      );
    }

    if (this.fuelLogsRepo) {
      versions['fuel_logs'] = await resolveVersion('fuel_logs', () =>
        this.fuelLogsRepo!.getMaxServerVersion(),
      );
    }

    if (this.consumableLogsRepo) {
      versions['consumable_logs'] = await resolveVersion('consumable_logs', () =>
        this.consumableLogsRepo!.getMaxServerVersion(),
      );
    }

    if (this.baleLoadsRepo) {
      versions['bale_loads'] = await resolveVersion('bale_loads', () =>
        this.baleLoadsRepo!.getMaxServerVersion(),
      );
    }

    if (this.taskAssignmentsRepo) {
      versions['task_assignments'] = await resolveVersion('task_assignments', () =>
        this.taskAssignmentsRepo!.getMaxServerVersion(),
      );
    }

    return versions;
  }

  /**
   * Apply a server-emitted tombstone by dropping the matching local row.
   * Idempotent — deleting a missing row is a no-op. Unknown tables are
   * logged and skipped so future server-side tombstones never crash sync.
   */
  private async applyTombstone(tomb: SyncTombstone): Promise<void> {
    switch (tomb.table) {
      case 'trips':
        await this.tripsRepo.delete(tomb.recordId);
        return;
      case 'bale_loads':
        if (this.baleLoadsRepo) await this.baleLoadsRepo.delete(tomb.recordId);
        return;
      case 'bale_productions':
        // `deleteLocal` already implements `DELETE FROM bale_productions WHERE id = ?` (FM-4).
        if (this.baleProductionsRepo) await this.baleProductionsRepo.deleteLocal(tomb.recordId);
        return;
      case 'fuel_logs':
        if (this.fuelLogsRepo) await this.fuelLogsRepo.deleteLocal(tomb.recordId);
        return;
      case 'consumable_logs':
        if (this.consumableLogsRepo) await this.consumableLogsRepo.deleteLocal(tomb.recordId);
        return;
      case 'task_assignments':
        if (this.taskAssignmentsRepo) await this.taskAssignmentsRepo.delete(tomb.recordId);
        return;
      case 'parcels':
        if (this.parcelsRepo) await this.parcelsRepo.delete(tomb.recordId);
        return;
      case 'machines':
        // Mobile has no machines repo — server-side tombstones for machines
        // are swallowed silently. They still advance the persisted cursor
        // so the row is not redelivered.
        return;
      default:
        mobileLogger.warn('Sync: ignoring tombstone for unknown table', {
          table: tomb.table,
          recordId: tomb.recordId,
        });
    }
  }

  /**
   * Apply a single server update to the local database.
   */
  private async applyUpdate(update: SyncResultDto): Promise<void> {
    if (!update.data || update.status !== 'applied') return;

    if (update.table === 'trips') {
      const existing = await this.tripsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        // Server confirmed the trip state — clear the local pending-transition flag.
        (merged as Record<string, unknown>)['has_pending_transition'] = 0;
        await this.tripsRepo.upsert(merged as unknown as LocalTrip);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.tripsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
          has_pending_transition: 0,
        } as unknown as LocalTrip);
      }
      return;
    }

    if (update.table === 'bale_productions' && this.baleProductionsRepo) {
      const existing = await this.baleProductionsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.baleProductionsRepo.upsert(merged as unknown as LocalBaleProduction);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.baleProductionsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalBaleProduction);
      }
      return;
    }

    if (update.table === 'fuel_logs' && this.fuelLogsRepo) {
      const existing = await this.fuelLogsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.fuelLogsRepo.upsert(merged as unknown as LocalFuelLog);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.fuelLogsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalFuelLog);
      }
      return;
    }

    if (update.table === 'consumable_logs' && this.consumableLogsRepo) {
      const existing = await this.consumableLogsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.consumableLogsRepo.upsert(merged as unknown as LocalConsumableLog);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.consumableLogsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalConsumableLog);
      }
      return;
    }

    if (update.table === 'bale_loads' && this.baleLoadsRepo) {
      const existing = await this.baleLoadsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.baleLoadsRepo.upsert(merged as unknown as LocalBaleLoad);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.baleLoadsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalBaleLoad);
      }
      return;
    }

    if (update.table === 'task_assignments' && this.taskAssignmentsRepo) {
      const existing = await this.taskAssignmentsRepo.findById(update.recordId);
      if (existing) {
        const { merged, divergentFields } = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.taskAssignmentsRepo.upsert(merged as unknown as LocalTaskAssignment);
        await notifyDivergentFields(update.table, update.recordId, divergentFields);
      } else {
        await this.taskAssignmentsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalTaskAssignment);
      }
      return;
    }

    // FM-13 — cache parcel geometry received via pull for offline map rendering
    if (update.table === 'parcels' && this.parcelsRepo && update.data) {
      const d = update.data;
      const centroid = d['centroid'] ?? d['centroid_json'] ?? null;
      await this.parcelsRepo.upsert({
        id: update.recordId,
        name: String(d['name'] ?? ''),
        code: String(d['code'] ?? ''),
        area_hectares: typeof d['area_hectares'] === 'number' ? d['area_hectares'] : null,
        municipality: typeof d['municipality'] === 'string' ? d['municipality'] : null,
        harvest_status: typeof d['harvest_status'] === 'string' ? d['harvest_status'] : null,
        centroid_json:
          centroid !== null && centroid !== undefined ? JSON.stringify(centroid) : null,
        geometry:
          d['boundary'] !== null && d['boundary'] !== undefined
            ? JSON.stringify(d['boundary'])
            : null,
        cached_at: new Date().toISOString(),
      } as LocalParcel);
    }
  }

  /**
   * Walk the pending sync_queue and, for any fuel_logs / consumable_logs /
   * delivery operations mutation whose photo is still a local file:// URI,
   * try to upload the photo and patch the queue payload with the server URL.
   *
   * This is the recovery path for photos that failed to upload synchronously
   * at save time (e.g. the operator was offline).
   */
  private async uploadPendingReceipts(): Promise<void> {
    const pending = await this.syncQueueRepo.dequeue(100);
    if (pending.length === 0) return;

    for (const entry of pending) {
      if (
        entry.entity_type !== 'fuel_logs' &&
        entry.entity_type !== 'consumable_logs' &&
        entry.entity_type !== 'operations'
      ) {
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(entry.payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Delivery photo: operations with type='delivery' and a local photo_uri
      if (entry.entity_type === 'operations') {
        if (payload['type'] !== 'delivery') continue;
        const localUri = payload['photo_uri'];
        if (typeof localUri !== 'string' || !localUri.startsWith('file://')) continue;
        try {
          const uploaded = await uploadReceipt(localUri, 'delivery');
          payload['photo_uri'] = uploaded.url;
          await this.syncQueueRepo.updatePayload(entry.id, payload);
        } catch (err) {
          mobileLogger.info('Deferred delivery photo upload skipped, will retry next cycle', {
            id: entry.entity_id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      // Receipt photos: fuel_logs / consumable_logs
      if (typeof payload['receipt_photo_url'] === 'string' && payload['receipt_photo_url']) {
        continue;
      }

      const localUri = await this.getLocalReceiptUri(entry.entity_type, entry.entity_id);
      if (!localUri) continue;

      try {
        const kind = entry.entity_type === 'fuel_logs' ? 'fuel' : 'consumable';
        const uploaded = await uploadReceipt(localUri, kind);
        payload['receipt_photo_url'] = uploaded.url;
        await this.syncQueueRepo.updatePayload(entry.id, payload);

        if (entry.entity_type === 'fuel_logs' && this.fuelLogsRepo) {
          await this.fuelLogsRepo.updateReceiptUrl(entry.entity_id, uploaded.url);
        } else if (entry.entity_type === 'consumable_logs' && this.consumableLogsRepo) {
          await this.consumableLogsRepo.updateReceiptUrl(entry.entity_id, uploaded.url);
        }
      } catch (err) {
        mobileLogger.info('Deferred receipt upload skipped, will retry next cycle', {
          table: entry.entity_type,
          id: entry.entity_id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async getLocalReceiptUri(table: string, id: string): Promise<string | null> {
    if (table === 'fuel_logs' && this.fuelLogsRepo) {
      const row = await this.fuelLogsRepo.findById(id);
      return row?.receipt_photo_uri ?? null;
    }
    if (table === 'consumable_logs' && this.consumableLogsRepo) {
      const row = await this.consumableLogsRepo.findById(id);
      return row?.receipt_photo_uri ?? null;
    }
    return null;
  }
}
