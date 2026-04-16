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
    try {
      const entries = await this.syncQueueRepo.dequeue(50);
      if (entries.length === 0) {
        return { count: 0, errors: [] };
      }

      const ids = entries.map((e) => e.id);
      await this.syncQueueRepo.markInFlight(ids);

      const result = await pushMutations(entries, this.apiClient);

      if (result.completedIds.length > 0) {
        await this.syncQueueRepo.markCompleted(result.completedIds);
      }

      for (const failed of result.failedEntries) {
        await this.syncQueueRepo.markFailed(failed.id, failed.error);
      }

      return { count: result.count, errors: result.errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Push failed';
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
}
