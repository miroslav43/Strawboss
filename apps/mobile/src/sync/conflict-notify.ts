import * as Notifications from 'expo-notifications';
import { mobileLogger } from '../lib/logger';
import type { DivergentField } from './conflict';

/**
 * FM-3: Human-readable labels for divergent fields shown in notifications.
 */
const FIELD_LABELS: Record<string, string> = {
  bale_count: 'Contor baloți',
  parcel_id: 'Parcelă',
  notes: 'Note',
  gross_weight_kg: 'Greutate brută (kg)',
  tare_weight_kg: 'Greutate tară (kg)',
  quantity: 'Cantitate',
  quantity_liters: 'Litri',
  avg_bale_weight_kg: 'Greutate medie baloți (kg)',
};

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
    const label = FIELD_LABELS[field] ?? field;
    const body = `${label} a fost actualizat de pe server: ${String(localValue)} → ${String(serverValue)}`;

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
          title: 'Date actualizate de pe server',
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
