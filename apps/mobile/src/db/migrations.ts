import type * as SQLite from 'expo-sqlite';
import { TABLES } from './schema';

/**
 * Run all database migrations.
 * Using CREATE TABLE IF NOT EXISTS so these are safe to re-run.
 */
export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(TABLES.operations);
  await db.execAsync(TABLES.trips);
  await db.execAsync(TABLES.sync_queue);

  // Create indexes for common queries
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_operations_trip_id ON operations(trip_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`
  );
}
