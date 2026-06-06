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
 */
import { Platform } from 'react-native';
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

  mobileLogger.flow('Watchdog: tracking should be on but is not — restarting', { machineId });
  try {
    await startBackgroundLocationTracking(machineId);
  } catch (err) {
    // Best-effort: starting a location foreground service can be refused when
    // called from a backgrounded WorkManager worker on Android 14+. It will
    // succeed on the next foreground pass (AppState 'active').
    mobileLogger.warn('Watchdog: failed to restart tracking', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
