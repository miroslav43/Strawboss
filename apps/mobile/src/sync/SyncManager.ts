import type { ApiClient } from '@strawboss/api';
import type { SyncResult as SyncResultDto } from '@strawboss/types';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo, type LocalTrip } from '../db/trips-repo';
import { pushMutations } from './push';
import { pullUpdates } from './pull';
import { mergeRecords } from './conflict';

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
  ) {}

  /**
   * Run a full sync cycle: push pending changes, then pull updates.
   */
  async sync(): Promise<SyncResult> {
    const pushResult = await this.push();
    const pullResult = await this.pull();

    return {
      pushed: pushResult.count,
      pulled: pullResult.count,
      errors: [...pushResult.errors, ...pullResult.errors],
    };
  }

  /**
   * Push all pending mutations to the server.
   */
  private async push(): Promise<{ count: number; errors: string[] }> {
    try {
      // Dequeue pending entries
      const entries = await this.syncQueueRepo.dequeue(50);
      if (entries.length === 0) {
        return { count: 0, errors: [] };
      }

      // Mark as in-flight to prevent re-processing
      const ids = entries.map((e) => e.id);
      await this.syncQueueRepo.markInFlight(ids);

      // Push to server
      const result = await pushMutations(entries, this.apiClient);

      // Mark completed entries
      if (result.completedIds.length > 0) {
        await this.syncQueueRepo.markCompleted(result.completedIds);
      }

      // Mark failed entries
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
      // Get the latest server_version we have for each table
      const lastVersions = await this.getLastVersions();

      const result = await pullUpdates(lastVersions, this.apiClient);

      if (result.updates.length === 0) {
        return { count: 0, errors: result.errors };
      }

      // Apply updates to local database
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
    // For now, query max server_version from each local table
    // In future, this could be stored in a metadata table
    const versions: Record<string, number> = {
      trips: 0,
      operations: 0,
    };

    try {
      const trips = await this.tripsRepo.listAll();
      if (trips.length > 0) {
        versions['trips'] = Math.max(...trips.map((t) => t.server_version));
      }
    } catch {
      // Table might be empty, use 0
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
        const existingRecord = existing as unknown as Record<string, unknown>;
        const merged = mergeRecords(update.table, update.recordId, existingRecord, {
          ...update.data,
          server_version: update.serverVersion,
        });
        await this.tripsRepo.upsert(merged as unknown as LocalTrip);
      } else {
        await this.tripsRepo.upsert({
          ...update.data,
          id: update.recordId,
          server_version: update.serverVersion,
        } as unknown as LocalTrip);
      }
    }
    // Add more table handlers as needed (operations, etc.)
  }
}
