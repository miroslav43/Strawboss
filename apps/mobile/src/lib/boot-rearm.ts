/**
 * Headless JS task that re-arms background location tracking after a device
 * reboot (or APK update), with NO user interaction.
 *
 * The native `BootReceiver` (see plugins/withAlwaysOnTracking) fires on
 * BOOT_COMPLETED / MY_PACKAGE_REPLACED, starts `BootRearmService` (a short-lived
 * `location`-typed foreground service) which boots the JS runtime and runs THIS
 * task. We must run in JS — not Kotlin — because `getAuthToken()` reads the
 * Supabase session, which only the JS client can hydrate.
 *
 * Registered at module load via `register-background-tasks.ts` so the headless
 * runtime can resolve the task key before any React screen mounts.
 */
import { AppRegistry } from 'react-native';
import { getAuthToken } from './auth';
import { getPersistedMachineId, startBackgroundLocationTracking } from './location';
import { registerBackgroundSyncTask } from './background-sync';
import { runBackgroundSyncCycle } from '../sync/run-background-sync';
import { mobileLogger } from './logger';

/** Must match the task key used by the native BootRearmService. */
export const BOOT_REARM_TASK_NAME = 'strawboss-boot-rearm';

async function bootRearm(): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    mobileLogger.flow('Boot re-arm: no session — skipping');
    return;
  }
  const machineId = await getPersistedMachineId();
  if (!machineId) {
    mobileLogger.flow('Boot re-arm: no persisted machine id — skipping');
    return;
  }

  mobileLogger.flow('Boot re-arm: restarting background tracking', { machineId });
  try {
    // We are running inside BootRearmService, which is already a foreground
    // service, so the app counts as foreground and starting the Expo location
    // foreground service is permitted (combined with ACCESS_BACKGROUND_LOCATION).
    await startBackgroundLocationTracking(machineId);
  } catch (err) {
    mobileLogger.warn('Boot re-arm: startBackgroundLocationTracking failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Re-register the periodic WorkManager sync and do one opportunistic sync now.
  try {
    await registerBackgroundSyncTask();
    await runBackgroundSyncCycle();
  } catch (err) {
    mobileLogger.warn('Boot re-arm: sync bootstrap failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// The headless task factory returns the async task fn. The native side stops the
// foreground service once this promise resolves (onHeadlessJsTaskFinish).
AppRegistry.registerHeadlessTask(BOOT_REARM_TASK_NAME, () => bootRearm);
