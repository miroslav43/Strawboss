import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '@strawboss/api';
import { getDatabase } from '../lib/storage';
import { getSupabaseClient } from '../lib/auth';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo } from '../db/trips-repo';
import { BaleProductionsRepo } from '../db/bale-productions-repo';
import { FuelLogsRepo } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo } from '../db/consumable-logs-repo';
import { BaleLoadsRepo } from '../db/bale-loads-repo';
import { TaskAssignmentsRepo } from '../db/task-assignments-repo';
import { SyncManager } from '../sync/SyncManager';
import { useNetworkStatus } from './useNetworkStatus';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Hook that provides sync state and a trigger function.
 * Auto-syncs when network reconnects if there are pending changes.
 */
export function useSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedQueueCount, setFailedQueueCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const { isConnected } = useNetworkStatus();
  const wasDisconnected = useRef(false);
  const queryClient = useQueryClient();

  const refreshPendingCount = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      const [count, failed] = await Promise.all([
        repo.getPendingCount(),
        repo.getFailedCount(),
      ]);
      setPendingCount(count);
      setFailedQueueCount(failed);
    } catch {
      // Ignore errors in background count refresh
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncing) return;

    setSyncing(true);
    setErrors([]);

    try {
      const db = await getDatabase();
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();

      const apiClient = new ApiClient({
        baseUrl: API_BASE_URL,
        getToken: async () => data.session?.access_token ?? null,
      });

      const syncQueueRepo = new SyncQueueRepo(db);
      const tripsRepo = new TripsRepo(db);
      const baleProductionsRepo = new BaleProductionsRepo(db);
      const fuelLogsRepo = new FuelLogsRepo(db);
      const consumableLogsRepo = new ConsumableLogsRepo(db);
      const baleLoadsRepo = new BaleLoadsRepo(db);
      const taskAssignmentsRepo = new TaskAssignmentsRepo(db);
      const manager = new SyncManager(
        syncQueueRepo,
        tripsRepo,
        apiClient,
        baleProductionsRepo,
        fuelLogsRepo,
        consumableLogsRepo,
        baleLoadsRepo,
        taskAssignmentsRepo,
      );

      const result = await manager.sync();

      if (result.errors.length === 0) {
        setLastSyncAt(new Date().toISOString());
      } else {
        setErrors(result.errors);
      }

      // After a sync cycle, refresh any server-backed views that depend on
      // the tables we just pushed. This is what makes the loader's trip
      // cards and "Încărcări înregistrate azi" list update without the user
      // having to pull-to-refresh.
      if (result.pushed > 0 || result.pulled > 0) {
        queryClient.invalidateQueries({ queryKey: ['trips-to-load'] });
        queryClient.invalidateQueries({ queryKey: ['bale-loads'] });
        queryClient.invalidateQueries({ queryKey: ['trips'] });
        queryClient.invalidateQueries({ queryKey: ['operator-stats'] });
      }

      await refreshPendingCount();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      setErrors((prev) => [...prev, message]);
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshPendingCount, queryClient]);

  const retryFailedAndSync = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      await repo.retryAllFailed();
      await refreshPendingCount();
    } catch {
      // Non-fatal; triggerSync may still run pending rows
    }
    await triggerSync();
  }, [refreshPendingCount, triggerSync]);

  /**
   * Delete failed/completed entries from the local queue. Pending and
   * in-flight rows are preserved so we never discard data that hasn't been
   * attempted yet.
   */
  const clearFailedQueue = useCallback(async (): Promise<number> => {
    const db = await getDatabase();
    const repo = new SyncQueueRepo(db);
    const deleted = await repo.clearFailed();
    await refreshPendingCount();
    return deleted;
  }, [refreshPendingCount]);

  /** Wipe the entire sync queue — use only when the user explicitly confirms. */
  const clearEntireQueue = useCallback(async (): Promise<number> => {
    const db = await getDatabase();
    const repo = new SyncQueueRepo(db);
    const deleted = await repo.clearAll();
    await refreshPendingCount();
    return deleted;
  }, [refreshPendingCount]);

  // Refresh pending count periodically
  useEffect(() => {
    void refreshPendingCount();
    const interval = setInterval(() => {
      void refreshPendingCount();
    }, 10_000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  // Auto-sync when coming back online with pending changes
  useEffect(() => {
    if (!isConnected) {
      wasDisconnected.current = true;
      return;
    }

    if (wasDisconnected.current && pendingCount > 0) {
      wasDisconnected.current = false;
      void triggerSync();
    }
  }, [isConnected, pendingCount, triggerSync]);

  return {
    syncing,
    lastSyncAt,
    pendingCount,
    failedQueueCount,
    errors,
    triggerSync,
    retryFailedAndSync,
    clearFailedQueue,
    clearEntireQueue,
  };
}
