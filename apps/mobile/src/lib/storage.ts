import * as SQLite from 'expo-sqlite';
import { runMigrations } from '../db/migrations';
import { debugIngest } from './debug-ingest';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or initialize the SQLite database singleton.
 * Runs migrations on first access.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    // #region agent log
    debugIngest(
      'storage.ts:getDatabase',
      'openDatabaseAsync start',
      { hasEnvApi: !!process.env.EXPO_PUBLIC_API_URL },
      'H1'
    );
    // #endregion
    const t0 = Date.now();
    try {
      db = await SQLite.openDatabaseAsync('strawboss.db');
      // #region agent log
      debugIngest(
        'storage.ts:getDatabase',
        'openDatabaseAsync done',
        { ms: Date.now() - t0 },
        'H1'
      );
      // #endregion
      await runMigrations(db);
      // #region agent log
      debugIngest(
        'storage.ts:getDatabase',
        'runMigrations done',
        { ms: Date.now() - t0 },
        'H1'
      );
      // #endregion
    } catch (err) {
      // #region agent log
      debugIngest(
        'storage.ts:getDatabase',
        'getDatabase error',
        {
          ms: Date.now() - t0,
          err: err instanceof Error ? err.message : String(err),
        },
        'H1'
      );
      // #endregion
      throw err;
    }
  }
  return db;
}

/**
 * Delete all user-specific rows from every local table.
 * Called on logout so the next user starts with a clean slate.
 */
export async function clearLocalData(): Promise<void> {
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
  `);
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
