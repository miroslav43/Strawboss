/**
 * Self-heal watchdog for always-on background location tracking.
 *
 * If the OS (Doze, low-memory, an OEM task-killer) tears down the location
 * foreground service while the user is still logged in and assigned to a
 * machine, nothing else would restart it until the next manual app open. This
 * cheap, JS-only check re-arms tracking whenever it *should* be running but is
 * not. It is invoked from two places that fire without user interaction:
 *   1. the 15-min `expo-background-task` WorkManager job (survives reboot), and
 *   2. the AppState 'active' handler in `app/_layout.tsx` (foreground recovery).
 *
 * "Should be running" = a machine id is persisted on disk (written when tracking
 * starts, cleared on logout/stop) AND a valid Supabase session exists.
 *
 * Two things this watchdog got wrong for months, both now fixed at the source:
 *  - It asked `hasStartedLocationUpdatesAsync` whether tracking was alive. That
 *    reads a PERSISTED registry which survives process death, so it answered
 *    "yes" on phones that had emitted nothing but tower fixes for days and the
 *    watchdog returned early every single time. Liveness now means a fix was
 *    actually delivered recently (see isBackgroundLocationTrackingActive).
 *  - When it did fire from the WorkManager worker it made things WORSE:
 *    `startBackgroundLocationTracking` stopped the running service before
 *    starting it, and the start is refused off the foreground. That is now
 *    guarded inside that function, so a background call can no longer destroy a
 *    healthy service.
 */
import { AppState, Platform } from 'react-native';
import { getAuthToken } from './auth';
import { mobileLogger } from './logger';
import {
  getPersistedMachineId,
  isBackgroundLocationTrackingActive,
  startBackgroundLocationTracking,
} from './location';

export async function ensureTrackingArmed(): Promise<void> {
  // Background location FGS is Android-only in this app (iOS uses UIBackgroundModes
  // and is not auto-armed here).
  if (Platform.OS !== 'android') return;

  const machineId = await getPersistedMachineId();
  if (!machineId) return; // tracking is not supposed to be on (no machine / logged out)

  const token = await getAuthToken();
  if (!token) return; // session gone — do not start

  const running = await isBackgroundLocationTrackingActive();
  if (running) return;

  // expo-location refuses to start a location foreground service unless the
  // Activity is resumed, and the refusal comes AFTER the stop. Report the dead
  // service and wait for a foreground pass rather than tearing anything down.
  if (AppState.currentState !== 'active') {
    mobileLogger.flow('Watchdog: tracking is dead but app is backgrounded — deferring re-arm', {
      machineId,
      appState: AppState.currentState,
    });
    return;
  }

  mobileLogger.flow('Watchdog: tracking should be on but is not — restarting', { machineId });
  try {
    await startBackgroundLocationTracking(machineId);
  } catch (err) {
    mobileLogger.warn('Watchdog: failed to restart tracking', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
