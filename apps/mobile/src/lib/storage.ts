import * as SQLite from 'expo-sqlite';
import { runMigrations } from '../db/migrations';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or initialize the SQLite database singleton.
 * Runs migrations on first access.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('strawboss.db');
    await runMigrations(db);
  }
  return db;
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
