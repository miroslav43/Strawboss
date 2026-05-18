import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { getDatabase } from '@/lib/storage';
import { SyncQueueRepo, type SyncQueueEntry } from '@/db/sync-queue-repo';
import { useSync } from './useSync';

export interface SyncQueueStatus {
  /** Rows that are pending (not yet sent) or in_flight. */
  pendingCount: number;
  /** Rows that have permanently failed. */
  failedCount: number;
  /** Total unsent rows (pending + in_flight + failed). */
  totalUnsent: number;
  /** Whether a sync cycle is currently running. */
  syncing: boolean;
  /** ISO string of the last successful sync, or null. */
  lastSyncAt: string | null;
  /** Errors from the most recent sync cycle. */
  errors: string[];
  /** All entries currently in the queue (pending + failed). Used by the details screen. */
  allEntries: SyncQueueEntry[];
  /** Trigger a sync cycle immediately. */
  triggerSync: () => Promise<void>;
  /** Reset all failed rows to pending and trigger a sync. */
  retryFailedAndSync: () => Promise<void>;
  /** Retry a single queue entry by its row id. */
  retryEntry: (id: number) => Promise<void>;
  /** Refresh the entry list without triggering a sync. */
  refresh: () => Promise<void>;
}

/**
 * Hook that surfaces the full sync queue status for UI components.
 *
 * Builds on top of `useSync` (which owns the sync state machine and
 * periodic count refresh) and adds:
 * - the full list of queue entries (for the details screen)
 * - per-status counts broken out (pending vs failed)
 * - foreground-resume refresh
 */
export function useSyncQueueStatus(): SyncQueueStatus {
  const {
    syncing,
    lastSyncAt,
    pendingCount,
    failedQueueCount,
    errors,
    triggerSync,
    retryFailedAndSync,
  } = useSync();

  const [allEntries, setAllEntries] = useState<SyncQueueEntry[]>([]);

  const loadEntries = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      // Fetch both pending and failed entries for the details view
      const [pending, failed] = await Promise.all([repo.dequeue(200), repo.getFailedEntries()]);

      // Merge, deduplicate by id, sort newest first
      const seen = new Set<number>();
      const merged: SyncQueueEntry[] = [];
      for (const e of [...failed, ...pending]) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          merged.push(e);
        }
      }
      merged.sort((a, b) => b.id - a.id);
      setAllEntries(merged);
    } catch {
      // Non-critical — entries list stays stale
    }
  }, []);

  // Refresh entries whenever the sync state changes (after a cycle finishes)
  useEffect(() => {
    void loadEntries();
  }, [syncing, pendingCount, failedQueueCount, loadEntries]);

  // Also refresh on app foreground resume
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void loadEntries();
      }
    });
    return () => sub.remove();
  }, [loadEntries]);

  const retryEntry = useCallback(
    async (id: number) => {
      try {
        const db = await getDatabase();
        const repo = new SyncQueueRepo(db);
        await repo.retry(id);
        await loadEntries();
      } catch {
        // Non-fatal
      }
      await triggerSync();
    },
    [triggerSync, loadEntries],
  );

  return {
    pendingCount,
    failedCount: failedQueueCount,
    totalUnsent: pendingCount,
    syncing,
    lastSyncAt,
    errors,
    allEntries,
    triggerSync,
    retryFailedAndSync,
    retryEntry,
    refresh: loadEntries,
  };
}
