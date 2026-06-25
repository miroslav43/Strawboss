import * as Notifications from 'expo-notifications';
import { mobileLogger } from '../lib/logger';
import { tStatic } from '@/lib/i18n';
import { getDatabase } from '../lib/storage';
import { NotificationsRepo } from '../db/notifications-repo';
import { broadcastNotificationRefresh } from '../lib/notification-handler';
import {
  MobileNotificationCategory,
  MobileNotificationType,
  MobileNotificationSeverity,
} from '@/types/notifications';
import type { DivergentField } from './conflict';

/**
 * FM-3: Emit a local (device-only) notification for each field where the
 * server overwrote a user-entered local value with a different value.
 *
 * Deduped via the notifications table (INSERT OR IGNORE on a stable id keyed by
 * (table, recordId, field, serverValue)): a given divergence buzzes the user
 * EXACTLY ONCE, so even a divergence that recurs on every sync cycle can never
 * produce a notification flood. Silently skips if Notifications permission is
 * not granted.
 */
export async function notifyDivergentFields(
  table: string,
  recordId: string,
  divergentFields: DivergentField[],
): Promise<void> {
  if (divergentFields.length === 0) return;

  const db = await getDatabase();
  const notificationsRepo = new NotificationsRepo(db);
  let newCount = 0;

  for (const { field, localValue, serverValue } of divergentFields) {
    // Stable per-divergence id. INSERT OR IGNORE returns true only the first time
    // we ever see this exact (record, field, serverValue) — gating the OS
    // notification on it is what prevents re-firing on every sync cycle.
    const notifId = `conflict-${table}-${recordId}-${field}-${String(serverValue)}`;
    const label = tStatic(`notifications.push.fieldLabel.${field}`, {}) || field;
    const title = tStatic('notifications.push.conflictTitle');
    const body = tStatic('notifications.push.fieldUpdated', {
      label,
      local: String(localValue),
      server: String(serverValue),
    });

    const isNew = await notificationsRepo.insert({
      id: notifId,
      category: MobileNotificationCategory.system,
      type: MobileNotificationType.field_overwritten,
      title,
      body,
      dataJson: JSON.stringify({ type: 'field_overwritten', table, recordId, field }),
      severity: MobileNotificationSeverity.info,
      createdAt: Date.now(),
    });
    if (!isNew) continue;
    newCount++;

    mobileLogger.flow('conflict-notify: server overwrote local field', {
      table,
      recordId,
      field,
      localValue,
      serverValue,
    });

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: notifId,
        content: {
          title,
          body,
          data: { table, recordId, field },
        },
        trigger: null, // fire immediately
      });
    } catch (err) {
      // Non-fatal — notification permission may be denied or system unavailable.
      // The bell entry is already persisted (and deduped), so we never retry it.
      mobileLogger.warn('conflict-notify: could not schedule notification', {
        field,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (newCount > 0) broadcastNotificationRefresh();
}
