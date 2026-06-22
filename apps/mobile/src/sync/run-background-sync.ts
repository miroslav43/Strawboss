import * as Notifications from 'expo-notifications';
import { ApiClient } from '@strawboss/api';
import { getDatabase } from '../lib/storage';
import { getAuthToken } from '../lib/auth';
import { runDeviceCheckin } from '../lib/device-checkin';
import { todayInRomania } from '../lib/date';
import { mobileLogger } from '../lib/logger';
import { broadcastNotificationRefresh } from '../lib/notification-handler';
import { SyncQueueRepo } from '../db/sync-queue-repo';
import { TripsRepo } from '../db/trips-repo';
import { BaleProductionsRepo } from '../db/bale-productions-repo';
import { FuelLogsRepo } from '../db/fuel-logs-repo';
import { ConsumableLogsRepo } from '../db/consumable-logs-repo';
import { BaleLoadsRepo } from '../db/bale-loads-repo';
import { TaskAssignmentsRepo } from '../db/task-assignments-repo';
import { ParcelsRepo } from '../db/parcels-repo';
import { SyncCursorsRepo } from '../db/sync-cursors-repo';
import { SyncManager } from './SyncManager';
import { NotificationsRepo } from '../db/notifications-repo';
import {
  MobileNotificationCategory,
  MobileNotificationType,
  MobileNotificationSeverity,
} from '@/types/notifications';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Full push/pull sync cycle for use from hooks or headless TaskManager workers.
 * No-ops when there is no Supabase session (no token).
 * After pulling, generates local notifications for any new today's task assignments
 * so the bell icon updates even when Expo push tokens are unavailable.
 */
export async function runBackgroundSyncCycle(): Promise<void> {
  // Fleet check-in runs BEFORE the auth gate so telemetry + OTA work even when
  // no operator is logged in (15-min WorkManager cycle is the reliable trigger).
  try {
    await runDeviceCheckin();
  } catch {
    // Never let a check-in error abort the rest of the sync cycle.
  }

  const token = await getAuthToken();
  if (!token) {
    mobileLogger.debug('Background sync skipped: no session token');
    return;
  }

  const apiClient = new ApiClient({
    baseUrl: API_BASE_URL,
    getToken: getAuthToken,
    // Advertise tombstone support so /sync/pull returns deletions[].
    defaultHeaders: { 'X-Sync-Caps': 'tombstones-v1' },
  });

  const db = await getDatabase();
  const syncQueueRepo = new SyncQueueRepo(db);
  const tripsRepo = new TripsRepo(db);
  const baleProductionsRepo = new BaleProductionsRepo(db);
  const fuelLogsRepo = new FuelLogsRepo(db);
  const consumableLogsRepo = new ConsumableLogsRepo(db);
  const baleLoadsRepo = new BaleLoadsRepo(db);
  const taskAssignmentsRepo = new TaskAssignmentsRepo(db);
  const parcelsRepo = new ParcelsRepo(db);
  const syncCursorsRepo = new SyncCursorsRepo(db);

  const manager = new SyncManager(
    syncQueueRepo,
    tripsRepo,
    apiClient,
    baleProductionsRepo,
    fuelLogsRepo,
    consumableLogsRepo,
    baleLoadsRepo,
    taskAssignmentsRepo,
    // Pass ParcelsRepo so background sync applies parcel geometry updates and
    // tombstones — previously `undefined`, so the background path (the primary
    // periodic updater) silently dropped every parcel change.
    parcelsRepo,
    syncCursorsRepo,
  );

  const result = await manager.sync();

  const notificationsRepo = new NotificationsRepo(db);

  // Prune notification history older than 7 days
  await notificationsRepo.cleanupOlderThan(7 * 24 * 3600 * 1000);

  // Generate local notifications for any new today's task assignments.
  // This is the primary notification path when Expo push tokens are unavailable
  // (dev builds without FCM). INSERT OR IGNORE makes this idempotent.
  if (result.pulled > 0) {
    await _notifyNewAssignments(taskAssignmentsRepo, notificationsRepo);
  }

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

async function _notifyNewAssignments(
  taskAssignmentsRepo: TaskAssignmentsRepo,
  notificationsRepo: NotificationsRepo,
): Promise<void> {
  const today = todayInRomania();
  const assignments = await taskAssignmentsRepo.listByDate(today);
  if (assignments.length === 0) return;

  let newCount = 0;

  for (const assignment of assignments) {
    const notifId = `assignment-${assignment.id}`;

    // INSERT OR IGNORE — returns true only the first time we ever see this
    // assignment. This is the single source of truth for "is this new?".
    const isNew = await notificationsRepo.insert({
      id: notifId,
      category: MobileNotificationCategory.task,
      type: MobileNotificationType.assignment_created,
      title: 'Sarcină nouă pentru azi',
      body: 'Ai primit o sarcină nouă. Deschide aplicația pentru detalii.',
      dataJson: JSON.stringify({
        type: 'assignment_created',
        assignmentId: assignment.id,
        id: notifId,
      }),
      severity: MobileNotificationSeverity.info,
      createdAt: Date.now(),
    });

    // Already notified on a previous sync — never re-fire. (scheduleNotificationAsync
    // with `trigger: null` presents immediately on EVERY call; the identifier only
    // dedups *pending* schedules, not delivered ones — so gating on isNew is what
    // prevents the same assignment from buzzing on every sync cycle.)
    if (!isNew) continue;

    newCount++;

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: notifId,
        content: {
          title: 'Sarcină nouă pentru azi',
          body: 'Ai primit o sarcină nouă. Deschide aplicația pentru detalii.',
          data: {
            type: 'assignment_created',
            assignmentId: assignment.id,
            id: notifId,
          },
          sound: 'default',
        },
        trigger: null,
      });
    } catch (err) {
      // OS notification is best-effort; the in-app bell entry is already persisted
      // (and deduped), so the next sync will not retry it.
      mobileLogger.warn('Failed to schedule local task notification', {
        notifId,
        err: String(err),
      });
    }
  }

  if (newCount > 0) {
    // Refresh the bell icon for any React subscribers still mounted
    // (no-op when called from a headless background task).
    broadcastNotificationRefresh();
    mobileLogger.flow('Notified for new task assignments', { count: newCount, date: today });
  }
}
