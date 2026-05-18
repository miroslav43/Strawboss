import * as SQLite from 'expo-sqlite';
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
