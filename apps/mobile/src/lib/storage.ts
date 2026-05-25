import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { runMigrations } from '../db/migrations';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or initialize the SQLite database singleton.
 * Runs migrations on first access.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    const t0 = Date.now();
    try {
      db = await SQLite.openDatabaseAsync('strawboss.db');
      await runMigrations(db);
      if (__DEV__) console.info('[StrawBoss] DB init ok', { ms: Date.now() - t0 });
    } catch (err) {
      if (__DEV__) console.warn('[StrawBoss] DB init failed', err);
      throw err;
    }
  }
  return db;
}

/**
 * Best-effort delete of a filesystem path.
 * Never throws — logout must not crash because a file is missing.
 */
async function deleteFileIfExists(path: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (err) {
    if (__DEV__) console.warn('[StrawBoss] clearLocalData: could not delete', path, err);
  }
}

/**
 * Delete all user-specific rows from every local table and remove
 * file-system artefacts tied to the current user session:
 *
 *  - NDJSON log directory  (`<Documents>/strawboss-logs/`)
 *  - Pending location-report queue  (`<Documents>/strawboss-pending-location-reports.json`)
 *  - Location last-success marker   (`<Documents>/strawboss-location-last-success.txt`)
 *  - Machine-id cache used by the GPS background task
 *    (`<Documents>/strawboss-location-machine-id.txt`)
 *    This IS user-specific: it is written by `startBackgroundLocationTracking` with
 *    the user's assigned machine, so it must be cleared when the user logs out.
 *
 * File deletions are non-fatal — individual failures are swallowed so the
 * logout flow completes even when files are absent or locked.
 */
export async function clearLocalData(): Promise<void> {
  // 1. Purge SQLite rows
  const database = await getDatabase();
  await database.execAsync(`
    DELETE FROM trips;
    DELETE FROM operations;
    DELETE FROM bale_productions;
    DELETE FROM fuel_logs;
    DELETE FROM consumable_logs;
    DELETE FROM bale_loads;
    DELETE FROM task_assignments;
    DELETE FROM sync_queue;
    DELETE FROM notifications;
    DELETE FROM parcels;
    DELETE FROM delivery_destinations;
  `);

  // 2. Remove filesystem artefacts (all best-effort)
  const doc = FileSystem.documentDirectory ?? '';

  // NDJSON logs directory (contains category sub-dirs like all/, error/, etc.)
  await deleteFileIfExists(`${doc}strawboss-logs`);

  // Location-related files (paths mirror constants in src/lib/location.ts)
  await deleteFileIfExists(`${doc}strawboss-pending-location-reports.json`);
  await deleteFileIfExists(`${doc}strawboss-location-last-success.txt`);
  await deleteFileIfExists(`${doc}strawboss-location-machine-id.txt`);

  // Note: receipt/avatar uploads go directly to the server via multipart POST
  // and are NOT cached in a local directory — no local photo artefacts to clean.
}

/**
 * Close the database connection.
 * Used for cleanup/testing.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
