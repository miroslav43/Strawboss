/**
 * expo-notifications BACKGROUND task: FCM data-message wake → re-assert the always-on
 * native anchor + run an immediate fleet check-in.
 *
 * WHY THIS EXISTS
 * ---------------
 * The native AlarmManager anchor (PresenceService + PresenceAlarmReceiver, see
 * plugins/withDeviceOwner.js) keeps a device-owner phone checking in with the screen
 * off — UNTIL deep Doze throttles its `setExactAndAllowWhileIdle` alarm to the OS
 * maintenance windows (which drift 1-4 h apart the longer the phone sits idle). In that
 * gap the phone goes silent and the online dot flips stale (measured on-device: 26-73
 * min check-in gaps overnight — the alarm alone can't hold a 90 s presence window).
 *
 * High-priority FCM DATA messages are the one signal that pierces Doze. The backend
 * presence dead-man (QUEUE_PRESENCE_DEADMAN, every 2 min — fleet-push.service.ts) sends
 * `{ type: 'presence_wake' }` (android.priority=high) to any device-owner phone whose
 * last check-in has gone stale. Expo's ExpoFirebaseMessagingService dispatches EVERY
 * received message — data-only included — to the TaskManager tasks registered via
 * `Notifications.registerTaskAsync`, even when the app is backgrounded or terminated
 * (confirmed in expo-notifications 0.32 FirebaseMessagingDelegate.onMessageReceived →
 * unconditional `runTaskManagerTasks(...)`).
 *
 * This task is that landing pad. Defined at the bundle entry (register-background-tasks.ts
 * → index.js) so the headless runtime can resolve the task key with NO Activity mounted.
 * It intentionally reuses `presenceCheckin()` — the SAME work the native alarm tick does —
 * so a wake and an alarm tick are indistinguishable downstream (one source of truth).
 */
import * as TaskManager from 'expo-task-manager';
import { presenceCheckin } from './presence-checkin-task';
import { isDeviceOwner, startPresenceService } from './device-owner';
import { mobileLogger } from './logger';

/** Registered with expo-notifications via `Notifications.registerTaskAsync`. */
export const REMOTE_NOTIFICATION_TASK = 'strawboss-remote-notification';

/** FCM data-message `type` values that should trigger an immediate check-in. */
const WAKE_TYPES = new Set(['presence_wake', 'ota_checkin']);

/**
 * Pull the FCM `type` out of the expo-notifications task payload. For a RECEIVED data
 * message the payload is `{ notification: null, data: { dataString?, ...fcmData } }` —
 * the FCM data fields surface directly on `data` AND are mirrored as a JSON string in
 * `data.dataString`. A notification RESPONSE (user tap) carries `actionIdentifier`
 * instead — we ignore those (nothing to wake for). Reads every known shape so the
 * handler is robust to serialization differences across expo-notifications versions.
 */
function extractWakeType(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  // Notification response (user tapped a notification) — not a background data wake.
  if ('actionIdentifier' in d) return undefined;

  const inner = d.data as Record<string, unknown> | undefined;
  if (inner) {
    if (typeof inner.type === 'string') return inner.type;
    if (typeof inner.dataString === 'string') {
      try {
        const parsed = JSON.parse(inner.dataString) as { type?: unknown };
        if (typeof parsed.type === 'string') return parsed.type;
      } catch {
        /* dataString wasn't JSON — fall through */
      }
    }
  }
  // Fallback: some payload variants place the FCM data at the top level.
  if (typeof d.type === 'string') return d.type;
  return undefined;
}

TaskManager.defineTask(REMOTE_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    mobileLogger.warn('Remote-notification task error', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const type = extractWakeType(data);
  if (!type || !WAKE_TYPES.has(type)) return;

  mobileLogger.flow('FCM wake received → re-assert anchor + check-in', { type });

  // 1. Restore the self-sustaining native anchor FIRST. The whole point of the
  //    dead-man is to resurrect a phone whose FGS/alarm the OS tore down; a bare
  //    check-in makes it momentarily online but leaves it dependent on the next
  //    (throttled) alarm. Re-asserting PresenceService brings the FGS + alarm loop
  //    back. No-op cost when the anchor is already alive. Device-owner only.
  try {
    if (await isDeviceOwner()) await startPresenceService();
  } catch {
    /* best-effort — the check-in below still lands */
  }

  // 2. Full check-in path (fleet check-in + operator heartbeat + GPS continuity),
  //    identical to the alarm tick, so the phone is "online" again immediately.
  try {
    await presenceCheckin();
  } catch (err) {
    mobileLogger.warn('Remote-notification task: checkin failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
