import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiClient } from '@strawboss/api';
import { getDatabase } from '../lib/storage';
import { getSupabaseClient } from '../lib/auth';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo } from '../db/trips-repo';
import { BaleProductionsRepo } from '../db/bale-productions-repo';
import { FuelLogsRepo } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo } from '../db/consumable-logs-repo';
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
  const [errors, setErrors] = useState<string[]>([]);
  const { isConnected } = useNetworkStatus();
  const wasDisconnected = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new SyncQueueRepo(db);
      const count = await repo.getPendingCount();
      setPendingCount(count);
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
      const manager = new SyncManager(
        syncQueueRepo,
        tripsRepo,
        apiClient,
        baleProductionsRepo,
        fuelLogsRepo,
        consumableLogsRepo,
      );

      const result = await manager.sync();

      setLastSyncAt(new Date().toISOString());
      if (result.errors.length > 0) {
        setErrors(result.errors);
      }

      await refreshPendingCount();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      setErrors((prev) => [...prev, message]);
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshPendingCount]);

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

  return { syncing, lastSyncAt, pendingCount, errors, triggerSync };
}
