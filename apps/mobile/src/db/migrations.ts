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
  await db.execAsync(TABLES.bale_productions);
  await db.execAsync(TABLES.fuel_logs);
  await db.execAsync(TABLES.consumable_logs);
  await db.execAsync(TABLES.bale_loads);
  await db.execAsync(TABLES.task_assignments);
  await db.execAsync(TABLES.notifications);

  // Additive column migrations for users upgrading from older builds. SQLite
  // does not support `ADD COLUMN IF NOT EXISTS`, so we swallow the duplicate
  // column error instead. Keeping this inline keeps migration logic simple
  // and colocated with the table definitions above.
  await addColumnIfMissing(db, 'fuel_logs', 'receipt_photo_url', 'TEXT');
  await addColumnIfMissing(db, 'consumable_logs', 'receipt_photo_url', 'TEXT');

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
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_productions_operator_id ON bale_productions(operator_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_productions_parcel_id ON bale_productions(parcel_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fuel_logs_operator_id ON fuel_logs(operator_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fuel_logs_machine_id ON fuel_logs(machine_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_consumable_logs_operator_id ON consumable_logs(operator_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_consumable_logs_parcel_id ON consumable_logs(parcel_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_loads_trip_id ON bale_loads(trip_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_loads_parcel_id ON bale_loads(parcel_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_task_assignments_assigned_user_id ON task_assignments(assigned_user_id)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_task_assignments_assignment_date ON task_assignments(assignment_date)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)`
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)`
  );
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    // "duplicate column name" is the expected error on subsequent runs; any
    // other error is unexpected and should surface to the caller.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) throw err;
  }
}
