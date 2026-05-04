/**
 * Periodic SQLite → server sync via expo-background-task.
 * Uses WorkManager on Android and BGTaskScheduler on iOS.
 * Task must be defined at module load so headless JS startup can resolve it.
 */
import * as TaskManager from 'expo-task-manager';
import {
  registerTaskAsync,
  unregisterTaskAsync,
  BackgroundTaskResult,
} from 'expo-background-task';
import { runBackgroundSyncCycle } from '../sync/run-background-sync';
import { mobileLogger } from './logger';

export const STRAWBOSS_BACKGROUND_SYNC_TASK = 'strawboss-background-sync';

TaskManager.defineTask(STRAWBOSS_BACKGROUND_SYNC_TASK, async () => {
  try {
    await runBackgroundSyncCycle();
    return BackgroundTaskResult.Success;
  } catch (err) {
    mobileLogger.warn('Background sync task failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return BackgroundTaskResult.Failed;
  }
});

/** Register WorkManager (Android) / BGTaskScheduler (iOS) interval — minimum 15 minutes. */
export async function registerBackgroundSyncTask(): Promise<void> {
  try {
    await registerTaskAsync(STRAWBOSS_BACKGROUND_SYNC_TASK, {
      minimumInterval: 15,
    });
    mobileLogger.flow('Background sync task registered');
  } catch (err) {
    mobileLogger.warn('registerBackgroundSyncTask failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function unregisterBackgroundSyncTask(): Promise<void> {
  try {
    await unregisterTaskAsync(STRAWBOSS_BACKGROUND_SYNC_TASK);
    mobileLogger.flow('Background sync task unregistered');
  } catch {
    /* idempotent */
  }
}
