import { ApiClient } from '@strawboss/api';
import { getDatabase } from '../lib/storage';
import { getAuthToken } from '../lib/auth';
import { mobileLogger } from '../lib/logger';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo } from '../db/trips-repo';
import { BaleProductionsRepo } from '../db/bale-productions-repo';
import { FuelLogsRepo } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo } from '../db/consumable-logs-repo';
import { BaleLoadsRepo } from '../db/bale-loads-repo';
import { TaskAssignmentsRepo } from '../db/task-assignments-repo';
import { SyncManager } from './SyncManager';
import { NotificationsRepo } from '../db/notifications-repo';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Full push/pull sync cycle for use from hooks or headless TaskManager workers.
 * No-ops when there is no Supabase session (no token).
 */
export async function runBackgroundSyncCycle(): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    mobileLogger.debug('Background sync skipped: no session token');
    return;
  }

  const apiClient = new ApiClient({
    baseUrl: API_BASE_URL,
    getToken: getAuthToken,
  });

  const db = await getDatabase();
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

  // Prune notification history older than 7 days
  const notificationsRepo = new NotificationsRepo(db);
  await notificationsRepo.cleanupOlderThan(7 * 24 * 3600 * 1000);

  if (result.errors.length > 0) {
    mobileLogger.warn('Background sync finished with errors', {
      errors: result.errors,
      pushed: result.pushed,
      pulled: result.pulled,
    });
  } else {
    mobileLogger.flow('Background sync OK', {
      pushed: result.pushed,
      pulled: result.pulled,
    });
  }
}
