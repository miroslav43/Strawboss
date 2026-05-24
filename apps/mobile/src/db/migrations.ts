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
  // FM-13 — offline parcel geometry cache (idempotent via IF NOT EXISTS)
  await db.execAsync(TABLES.parcels);
  // Sync cursors per table — see schema.ts comment on tombstone retention.
  await db.execAsync(TABLES.sync_cursors);
  // Plan C — deposit dashboard write-through cache for offline cold boot.
  await db.execAsync(TABLES.deposit_inventory_cache);

  // Additive column migrations for users upgrading from older builds. SQLite
  // does not support `ADD COLUMN IF NOT EXISTS`, so we swallow the duplicate
  // column error instead. Keeping this inline keeps migration logic simple
  // and colocated with the table definitions above.
  await addColumnIfMissing(db, 'fuel_logs', 'receipt_photo_url', 'TEXT');
  await addColumnIfMissing(db, 'consumable_logs', 'receipt_photo_url', 'TEXT');
  // 'acknowledged_at' lets the driver "Cursele Mele" list flag freshly-loaded
  // trips with a NOU badge. Tap-to-acknowledge clears it locally — purely a
  // client-side flag, never sent to the server.
  await addColumnIfMissing(db, 'trips', 'acknowledged_at', 'TEXT');
  // 'destination_id' on trips: stored as FK to delivery_destinations so the
  // "Alege depozit" guard in trip detail can detect when the driver still
  // needs to pick a destination before departing.
  await addColumnIfMissing(db, 'trips', 'destination_id', 'TEXT');
  // 'next_retry_at' enables exponential back-off for failed sync entries.
  // NULL means "retry immediately" (existing rows) — no data migration needed.
  await addColumnIfMissing(db, 'sync_queue', 'next_retry_at', 'TEXT');
  // 'has_pending_transition' flags trips whose state machine transition has been
  // applied optimistically locally but not yet confirmed by the server.
  // Used by the UI to show a "will be sent on reconnect" badge (FM-1).
  await addColumnIfMissing(db, 'trips', 'has_pending_transition', 'INTEGER DEFAULT 0');
  // Delivery flow progress: stores the last completed delivery step so that
  // after a crash/close the flow can show a resume banner (FM-1).
  // Values: NULL = not started, 0–2 = step number completed.
  await addColumnIfMissing(db, 'trips', 'delivery_step_progress', 'INTEGER');
  // Stores serialized delivery data (weight, bales, photo URL, receiver) so
  // the driver does not have to re-enter if the app crashes mid-flow (FM-1).
  await addColumnIfMissing(db, 'trips', 'delivery_draft_json', 'TEXT');
  // Plan C — multi-iteration columns (matches server migration 00043).
  await addColumnIfMissing(db, 'trips', 'parent_trip_id', 'TEXT');
  await addColumnIfMissing(db, 'trips', 'iteration_index', 'INTEGER DEFAULT 1');

  // Create indexes for common queries
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_operations_trip_id ON operations(trip_id)`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status)`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status)`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`);
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_productions_operator_id ON bale_productions(operator_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_productions_parcel_id ON bale_productions(parcel_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fuel_logs_operator_id ON fuel_logs(operator_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fuel_logs_machine_id ON fuel_logs(machine_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_consumable_logs_operator_id ON consumable_logs(operator_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_consumable_logs_parcel_id ON consumable_logs(parcel_id)`,
  );
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_bale_loads_trip_id ON bale_loads(trip_id)`);
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_bale_loads_parcel_id ON bale_loads(parcel_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_task_assignments_assigned_user_id ON task_assignments(assigned_user_id)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_task_assignments_assignment_date ON task_assignments(assignment_date)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)`,
  );
  // FM-13 — parcel geometry cache indexes
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_parcels_cached_at ON parcels(cached_at)`);
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
