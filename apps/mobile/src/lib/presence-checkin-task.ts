/**
 * Headless JS task: fleet check-in + presence heartbeat, triggered by a NATIVE
 * AlarmManager tick (see plugins/withDeviceOwner.js → PresenceAlarmReceiver).
 *
 * WHY THIS EXISTS
 * ---------------
 * On aggressive OEM ROMs (HONOR / MagicOS, EMUI, MIUI) the OS pauses the React
 * Native JS runtime the moment the app is backgrounded (screen off) — even though
 * the process AND its foreground services (PresenceService + Expo location FGS)
 * stay alive and the CPU is awake. The symptom: `setInterval`-based heartbeats
 * and TaskManager location callbacks simply stop firing, so the device flips to
 * "offline" a few minutes after the screen goes off (verified on-device: the
 * process is State=S, 0% CPU, not frozen — JS is just idle; foregrounding the app
 * instantly resumes every timer).
 *
 * A wake lock does NOT fix this (the CPU was already awake). The fix is to stop
 * relying on JS timers for presence: a native exact alarm dispatches THIS headless
 * task into JS on a fresh context that is not tied to the (paused) Activity, so
 * check-ins keep flowing with the screen off. Reuses the full check-in path, so
 * fleet `last_seen`, Tailscale up/down, OTA, and remote commands all keep working
 * in the background — not just the online dot.
 *
 * Registered at module load via `register-background-tasks.ts` so the headless
 * runtime can resolve the task key before any React screen mounts.
 */
import { AppRegistry } from 'react-native';
import { getAuthToken } from './auth';
import { runDeviceCheckin } from './device-checkin';
import { sendHeartbeatOnce } from './heartbeat';
import {
  getPersistedMachineId,
  postBestEffortLocationNow,
  maybeFlushBatchedLocationReports,
} from './location';
import { mobileLogger } from './logger';

/** Must match the task name used by the native PresenceCheckinService. */
export const PRESENCE_CHECKIN_TASK_NAME = 'strawboss-presence-checkin';

export async function presenceCheckin(): Promise<void> {
  // 1. Fleet check-in is PUBLIC (no session needed): keeps devices.last_seen
  //    fresh AND delivers/applies any pending Tailscale / OTA / remote command.
  try {
    await runDeviceCheckin();
  } catch (err) {
    mobileLogger.warn('Presence checkin task: fleet checkin failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Operator session token — gates every authenticated call below.
  let token: string | null = null;
  try {
    token = await getAuthToken();
  } catch {
    token = null;
  }

  // 2. Operator presence (users.last_seen_at) — only when an operator is logged
  //    in. Best-effort: a failure here never affects the fleet check-in above.
  if (token) {
    try {
      await sendHeartbeatOnce();
    } catch {
      /* best-effort — next alarm tick retries */
    }
  }

  // 3. GPS continuity from THIS freeze-proof context. The OEM freeze that pauses JS
  //    timers (HONOR/MagicOS PowerGenie/iAware — both persistent system apps a Device
  //    Owner cannot hide/suspend/stop) ALSO pauses the Expo location foreground
  //    service, so without this the device stays "online" (presence rides the native
  //    alarm) but its GPS gaps until the next thaw. The alarm dispatches us on a fresh
  //    context, so posting a current fix + draining the outbox here keeps the position
  //    flowing to the dispatcher with the screen off / app frozen. Best-effort and
  //    idempotent (server dedups via the ON CONFLICT unique key), so it can never
  //    affect presence above.
  if (token) {
    try {
      const machineId = await getPersistedMachineId();
      if (machineId) {
        // Best-effort fast fix (last-known + Balanced) — a slow High-accuracy lock
        // gets frozen out by PowerGenie before it returns on HONOR. See
        // getBestEffortPosition().
        await postBestEffortLocationNow(machineId);
        // Gated (~60s shared floor with the FGS tick): when the FGS is alive
        // both drivers would otherwise flush back-to-back every minute; when
        // the FGS is dead the stamp is stale and the flush proceeds — the
        // recovery role of this alarm path is unchanged.
        await maybeFlushBatchedLocationReports();
      }
    } catch (err) {
      mobileLogger.warn('Presence checkin task: GPS continuity failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// The headless task factory returns the async task fn. The native side
// (HeadlessJsTaskService) stops itself once this promise resolves.
AppRegistry.registerHeadlessTask(PRESENCE_CHECKIN_TASK_NAME, () => presenceCheckin);
