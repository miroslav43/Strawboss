/**
 * FM-16 — Machine inactivity alarm
 *
 * Checks whether the current machine has reported a GPS location within the
 * configured inactivity threshold during working hours. If not, schedules a
 * single local push notification to warn the operator.
 *
 * Design constraints:
 * - Called from the AppState 'active' handler in app/_layout.tsx (non-blocking).
 * - Emits at most one notification per inactivity period — a debounce file
 *   (`LAST_ALARM_FILE`) records the last alarm time so we don't spam.
 * - Entirely client-side — no backend changes.
 */

import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import { mobileLogger } from './logger';
import { readLastLocationSuccessIso } from './location';
import { tStatic } from './i18n';

// ---------------------------------------------------------------------------
// Configuration constants (change these to adjust thresholds)
// ---------------------------------------------------------------------------

/** Inactivity window before an alarm fires (ms). Default: 2 hours. */
export const INACTIVITY_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/** Earliest hour (local time, inclusive) when the alarm is allowed to fire. */
export const WORK_START_HOUR = 7;

/** Latest hour (local time, exclusive) when the alarm is allowed to fire. */
export const WORK_END_HOUR = 19;

/**
 * Minimum gap between consecutive alarms (ms). Prevents repeated notifications
 * when the operator keeps reopening the app without GPS recovering.
 * Default: 1 hour.
 */
export const MIN_ALARM_INTERVAL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const doc = FileSystem.documentDirectory ?? '';
const LAST_ALARM_FILE = `${doc}strawboss-inactivity-last-alarm.txt`;

async function readLastAlarmIso(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_ALARM_FILE);
    if (!info.exists) return null;
    const raw = (await FileSystem.readAsStringAsync(LAST_ALARM_FILE)).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function writeLastAlarmNow(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(LAST_ALARM_FILE, new Date().toISOString());
  } catch {
    /* non-critical */
  }
}

function isWithinWorkingHours(now: Date): boolean {
  const hour = now.getHours();
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check machine inactivity and fire a local notification if warranted.
 *
 * Call this from the AppState 'active' handler. It is fast (two file reads
 * + one optional notification schedule) and safe to await.
 *
 * @param machineId - The assigned machine ID. If null/undefined the check is
 *                    a no-op (only machines with GPS are monitored).
 */
export async function checkMachineInactivity(machineId: string | null | undefined): Promise<void> {
  if (!machineId) return;

  const now = new Date();

  // Only check during declared working hours
  if (!isWithinWorkingHours(now)) return;

  // Read last successful GPS report timestamp
  const lastSuccessIso = await readLastLocationSuccessIso();
  if (!lastSuccessIso) {
    // No GPS report ever recorded — we can't distinguish "GPS never started"
    // from "GPS not yet reported". Skip to avoid false positives on first boot.
    return;
  }

  const lastSuccessMs = new Date(lastSuccessIso).getTime();
  const elapsedMs = now.getTime() - lastSuccessMs;

  if (elapsedMs < INACTIVITY_THRESHOLD_MS) return; // within threshold — all good

  // Machine is inactive. Check if we already fired an alarm recently.
  const lastAlarmIso = await readLastAlarmIso();
  if (lastAlarmIso) {
    const lastAlarmMs = new Date(lastAlarmIso).getTime();
    if (now.getTime() - lastAlarmMs < MIN_ALARM_INTERVAL_MS) return; // too soon
  }

  // Fire the notification
  const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const elapsedMinutes = Math.floor((elapsedMs % (60 * 60 * 1000)) / 60_000);
  const elapsedLabel =
    elapsedHours > 0 ? `${elapsedHours}h ${elapsedMinutes}min` : `${elapsedMinutes} min`;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: tStatic('inactivityAlarm.title'),
        body: tStatic('inactivityAlarm.body', { elapsedLabel }),
        data: { type: 'inactivity_alarm', machineId },
        // Importance is handled by the channel on Android
      },
      trigger: null, // fire immediately
    });

    await writeLastAlarmNow();

    mobileLogger.flow('Machine inactivity alarm fired', {
      machineId,
      elapsedMs,
      lastSuccessIso,
    });
  } catch (err) {
    mobileLogger.warn('Failed to schedule inactivity alarm notification', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear the last-alarm debounce file. Call this when GPS resumes successfully
 * so the next inactivity period can trigger a fresh alarm.
 */
export async function clearInactivityAlarmDebounce(): Promise<void> {
  try {
    await FileSystem.deleteAsync(LAST_ALARM_FILE, { idempotent: true });
  } catch {
    /* non-critical */
  }
}
