import type { ApiClient } from '@strawboss/api';
import type { SyncResult as SyncResultDto } from '@strawboss/types';
import { mobileLogger } from '../lib/logger';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo, type LocalTrip } from '../db/trips-repo';
import { BaleProductionsRepo, type LocalBaleProduction } from '../db/bale-productions-repo';
import { FuelLogsRepo, type LocalFuelLog } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo, type LocalConsumableLog } from '../db/consumable-logs-repo';
import { BaleLoadsRepo, type LocalBaleLoad } from '../db/bale-loads-repo';
import { TaskAssignmentsRepo, type LocalTaskAssignment } from '../db/task-assignments-repo';
import { pushMutations } from './push';
import { pullUpdates } from './pull';
import { mergeRecords } from './conflict';
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
  constructor(
    private syncQueueRepo: SyncQueueRepo,
    private tripsRepo: TripsRepo,
    private apiClient: ApiClient,
    private baleProductionsRepo?: BaleProductionsRepo,
    private fuelLogsRepo?: FuelLogsRepo,
    private consumableLogsRepo?: ConsumableLogsRepo,
    private baleLoadsRepo?: BaleLoadsRepo,
    private taskAssignmentsRepo?: TaskAssignmentsRepo,
  ) {}

  /**
   * Run a full sync cycle: push pending changes, then pull updates.
   */
  async sync(): Promise<SyncResult> {
    mobileLogger.flow('Sync cycle started');

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

    await this.syncQueueRepo.purgeCompleted();

    // Best-effort: upload receipt photos for rows that were saved offline or
    // whose initial upload attempt failed. Any failure here is non-fatal —
    // the mutation still pushes, just without a photo URL.
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

    mobileLogger.flow('Sync cycle finished', {
      pushed: result.pushed,
      pulled: result.pulled,
      errorCount: result.errors.length,
    });

    return result;
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

      const result = await pushMutations(entries, this.apiClient);

      if (result.completedIds.length > 0) {
        await this.syncQueueRepo.markCompleted(result.completedIds);
      }

      for (const failed of result.failedEntries) {
        await this.syncQueueRepo.markFailed(failed.id, failed.error);
      }

      const handled = new Set([
        ...result.completedIds,
        ...result.failedEntries.map((f) => f.id),
      ]);
      for (const id of batchIds) {
        if (!handled.has(id)) {
          await this.syncQueueRepo.markFailed(
            id,
            'Răspuns incomplet de la server pentru această înregistrare',
          );
        }
      }

      await this.syncQueueRepo.purgeCompleted();

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

      if (result.updates.length === 0) {
        return { count: 0, errors: result.errors };
      }

      let applied = 0;
      for (const update of result.updates) {
        try {
          await this.applyUpdate(update);
          applied++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Apply failed';
          result.errors.push(`Failed to apply ${update.table}/${update.recordId}: ${msg}`);
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
    };

    try {
      versions['trips'] = await this.tripsRepo.getMaxServerVersion();
    } catch {
      // Table might be empty
    }

    if (this.baleProductionsRepo) {
      try {
        versions['bale_productions'] = await this.baleProductionsRepo.getMaxServerVersion();
      } catch {
        // Table might be empty
      }
    }

    if (this.fuelLogsRepo) {
      try {
        versions['fuel_logs'] = await this.fuelLogsRepo.getMaxServerVersion();
      } catch {
        // Table might be empty
      }
    }

    if (this.consumableLogsRepo) {
      try {
        versions['consumable_logs'] = await this.consumableLogsRepo.getMaxServerVersion();
      } catch {
        // Table might be empty
      }
    }

    if (this.baleLoadsRepo) {
      try {
        versions['bale_loads'] = await this.baleLoadsRepo.getMaxServerVersion();
      } catch {
        // Table might be empty
      }
    }

    if (this.taskAssignmentsRepo) {
      try {
        versions['task_assignments'] = await this.taskAssignmentsRepo.getMaxServerVersion();
      } catch {
        // Table might be empty
      }
    }

    return versions;
  }

  /**
   * Apply a single server update to the local database.
   */
  private async applyUpdate(update: SyncResultDto): Promise<void> {
    if (!update.data || update.status !== 'applied') return;

    if (update.table === 'trips') {
      const existing = await this.tripsRepo.findById(update.recordId);
      if (existing) {
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.tripsRepo.upsert(merged as unknown as LocalTrip);
      } else {
        await this.tripsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalTrip);
      }
      return;
    }

    if (update.table === 'bale_productions' && this.baleProductionsRepo) {
      const existing = await this.baleProductionsRepo.findById(update.recordId);
      if (existing) {
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.baleProductionsRepo.upsert(merged as unknown as LocalBaleProduction);
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
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.fuelLogsRepo.upsert(merged as unknown as LocalFuelLog);
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
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.consumableLogsRepo.upsert(merged as unknown as LocalConsumableLog);
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
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.baleLoadsRepo.upsert(merged as unknown as LocalBaleLoad);
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
        const merged = mergeRecords(
          update.table,
          update.recordId,
          existing as unknown as Record<string, unknown>,
          { ...update.data, server_version: update.serverVersion },
        );
        await this.taskAssignmentsRepo.upsert(merged as unknown as LocalTaskAssignment);
      } else {
        await this.taskAssignmentsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalTaskAssignment);
      }
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

      const localUri = await this.getLocalReceiptUri(
        entry.entity_type,
        entry.entity_id,
      );
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

  private async getLocalReceiptUri(
    table: string,
    id: string,
  ): Promise<string | null> {
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
