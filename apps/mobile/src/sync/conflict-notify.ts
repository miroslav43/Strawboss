import * as Notifications from 'expo-notifications';
import { mobileLogger } from '../lib/logger';
import { tStatic } from '@/lib/i18n';
import type { DivergentField } from './conflict';

/**
 * FM-3: Emit a local (device-only) notification for each field where the
 * server overwrote a user-entered local value with a different value.
 *
 * Only significant numeric/text divergences are reported — not every field.
 * Silently skips if Notifications permission is not granted.
 */
export async function notifyDivergentFields(
  table: string,
  recordId: string,
  divergentFields: DivergentField[],
): Promise<void> {
  if (divergentFields.length === 0) return;

  for (const { field, localValue, serverValue } of divergentFields) {
    const label = tStatic(`notifications.push.fieldLabel.${field}`, {}) || field;
    const body = tStatic('notifications.push.fieldUpdated', {
      label,
      local: String(localValue),
      server: String(serverValue),
    });

    mobileLogger.flow('conflict-notify: server overwrote local field', {
      table,
      recordId,
      field,
      localValue,
      serverValue,
    });

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: tStatic('notifications.push.conflictTitle'),
          body,
          data: { table, recordId, field },
        },
        trigger: null, // fire immediately
      });
    } catch (err) {
      // Non-fatal — notification permission may be denied or system unavailable.
      mobileLogger.warn('conflict-notify: could not schedule notification', {
        field,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
