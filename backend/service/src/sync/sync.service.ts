import { Injectable, BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { SyncMutation, SyncResult } from '@strawboss/types';

/** Tables that support sync (have a sync_version column). */
const SYNCABLE_TABLES = new Set([
  'trips',
  'bale_loads',
  'bale_productions',
  'fuel_logs',
  'consumable_logs',
  'task_assignments',
  'machines',
  'parcels',
]);

/** Allowed column names per syncable table to prevent SQL injection via sql.raw(). */
const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  trips: new Set([
    'id', 'bale_count', 'departure_odometer_km', 'arrival_odometer_km',
    'departure_at', 'arrival_at', 'delivered_at', 'completed_at', 'cancelled_at',
    'destination_name', 'destination_address', 'gross_weight_kg', 'tare_weight_kg',
    'weight_ticket_number', 'weight_ticket_photo_url', 'delivery_notes',
    'receiver_name', 'receiver_signature_url', 'receiver_signed_at',
    'cancellation_reason', 'fraud_flags', 'gps_distance_km', 'distance_discrepancy_km',
    'source_parcel_id', 'truck_id', 'loader_id', 'driver_id', 'loader_operator_id',
    'loading_started_at', 'loading_completed_at', 'client_id', 'sync_version',
  ]),
  bale_loads: new Set([
    'id', 'trip_id', 'parcel_id', 'loader_id', 'operator_id',
    'bale_count', 'loaded_at', 'gps_lat', 'gps_lon', 'notes',
    'farmtrack_event_id', 'client_id', 'sync_version',
  ]),
  bale_productions: new Set([
    'id', 'parcel_id', 'baler_id', 'operator_id', 'production_date',
    'bale_count', 'avg_bale_weight_kg', 'start_time', 'end_time',
    'farmtrack_session_id', 'deleted_at', 'updated_at',
  ]),
  fuel_logs: new Set([
    'id', 'machine_id', 'operator_id', 'parcel_id', 'logged_at',
    'fuel_type', 'quantity_liters', 'unit_price', 'total_cost',
    'odometer_km', 'hourmeter_hrs', 'is_full_tank', 'receipt_photo_url',
    'notes', 'client_id', 'sync_version',
  ]),
  consumable_logs: new Set([
    'id', 'machine_id', 'operator_id', 'parcel_id', 'consumable_type',
    'description', 'quantity', 'unit', 'unit_price', 'total_cost', 'logged_at',
    'receipt_photo_url', 'deleted_at', 'updated_at',
    'client_id', 'sync_version',
  ]),
  task_assignments: new Set([
    'id', 'assignment_date', 'machine_id', 'parcel_id', 'assigned_user_id',
    'priority', 'sequence_order', 'status', 'parent_assignment_id',
    'destination_id', 'estimated_start', 'estimated_end', 'actual_start',
    'actual_end', 'notes', 'deleted_at', 'updated_at',
  ]),
  machines: new Set([
    'id', 'machine_type', 'registration_plate', 'internal_code', 'make',
    'model', 'year', 'fuel_type', 'tank_capacity_liters', 'is_active',
    'current_odometer_km', 'current_hourmeter_hrs',
    'max_payload_kg', 'max_bale_count', 'tare_weight_kg',
    'bales_per_hour_avg', 'bale_weight_avg_kg', 'reach_meters',
    'farmtrack_device_id',
  ]),
  parcels: new Set([
    'id', 'code', 'name', 'owner_name', 'owner_contact', 'area_hectares',
    'boundary', 'centroid', 'address', 'municipality', 'notes',
    'is_active', 'harvest_status', 'farmtrack_geofence_id', 'farm_id',
  ]),
};

function validateColumnName(table: string, column: string): void {
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed || !allowed.has(column)) {
    throw new BadRequestException(
      `Column '${column}' is not allowed for sync on table '${table}'`,
    );
  }
}

@Injectable()
export class SyncService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Process a batch of offline mutations with idempotency.
   */
  async push(mutations: SyncMutation[], _callerId?: string): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const mutation of mutations) {
      if (!SYNCABLE_TABLES.has(mutation.table)) {
        throw new BadRequestException(
          `Table '${mutation.table}' is not syncable`,
        );
      }

      // 1. Idempotency check
      const existing = await this.drizzleProvider.db.execute(
        sql`SELECT server_version, result_data FROM sync_idempotency
            WHERE client_id = ${mutation.clientId}
              AND table_name = ${mutation.table}
              AND record_id = ${mutation.recordId}
              AND client_version = ${mutation.clientVersion}
            LIMIT 1`,
      );
      const existingRows = existing as unknown as Record<string, unknown>[];

      if (existingRows.length > 0) {
        // Already processed — return cached result
        results.push({
          table: mutation.table,
          recordId: mutation.recordId,
          status: 'skipped',
          serverVersion: existingRows[0].server_version as number,
          data: existingRows[0].result_data as Record<string, unknown> | null,
        });
        continue;
      }

      // 2. Apply the mutation
      let resultData: Record<string, unknown> | null = null;
      let serverVersion = 0;

      if (mutation.action === 'insert') {
        const dataWithVersion = { ...mutation.data, sync_version: 1 };
        const columns = Object.keys(dataWithVersion);
        // Validate all column names before using sql.raw
        for (const col of columns) {
          if (col !== 'sync_version') validateColumnName(mutation.table, col);
        }
        const values = Object.values(dataWithVersion);

        const colsSql = sql.raw(columns.map((c) => `"${c}"`).join(', '));
        const placeholders = values.map((v) =>
          typeof v === 'object' && v !== null
            ? sql`${JSON.stringify(v)}::jsonb`
            : sql`${v}`,
        );
        const valsSql = sql.join(placeholders, sql`, `);

        const insertResult = await this.drizzleProvider.db.execute(
          sql`INSERT INTO ${sql.raw(`"${mutation.table}"`)} (${colsSql})
              VALUES (${valsSql})
              RETURNING *`,
        );
        const rows = insertResult as unknown as Record<string, unknown>[];
        resultData = rows[0] ?? null;
        serverVersion = 1;
      } else if (mutation.action === 'update') {
        // Get current sync_version
        const currentResult = await this.drizzleProvider.db.execute(
          sql`SELECT sync_version FROM ${sql.raw(`"${mutation.table}"`)}
              WHERE id = ${mutation.recordId} LIMIT 1`,
        );
        const currentRows = currentResult as unknown as Record<string, unknown>[];
        const currentVersion = (currentRows[0]?.sync_version as number) ?? 0;
        serverVersion = currentVersion + 1;

        const setClauses: ReturnType<typeof sql>[] = [
          sql`sync_version = ${serverVersion}`,
          sql`updated_at = NOW()`,
        ];
        for (const [key, value] of Object.entries(mutation.data)) {
          if (key !== 'id' && key !== 'sync_version' && key !== 'updated_at') {
            validateColumnName(mutation.table, key);
            if (typeof value === 'object' && value !== null) {
              setClauses.push(
                sql`${sql.raw(`"${key}"`)} = ${JSON.stringify(value)}::jsonb`,
              );
            } else {
              setClauses.push(sql`${sql.raw(`"${key}"`)} = ${value}`);
            }
          }
        }

        const setClause = sql.join(setClauses, sql`, `);
        const updateResult = await this.drizzleProvider.db.execute(
          sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
              SET ${setClause}
              WHERE id = ${mutation.recordId}
              RETURNING *`,
        );
        const rows = updateResult as unknown as Record<string, unknown>[];
        resultData = rows[0] ?? null;
      } else if (mutation.action === 'delete') {
        // Soft delete
        const currentResult = await this.drizzleProvider.db.execute(
          sql`SELECT sync_version FROM ${sql.raw(`"${mutation.table}"`)}
              WHERE id = ${mutation.recordId} LIMIT 1`,
        );
        const currentRows = currentResult as unknown as Record<string, unknown>[];
        const currentVersion = (currentRows[0]?.sync_version as number) ?? 0;
        serverVersion = currentVersion + 1;

        await this.drizzleProvider.db.execute(
          sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
              SET deleted_at = NOW(), sync_version = ${serverVersion}, updated_at = NOW()
              WHERE id = ${mutation.recordId}`,
        );
      }

      // 3. Record in idempotency table
      await this.drizzleProvider.db.execute(
        sql`INSERT INTO sync_idempotency (
          client_id, table_name, record_id, client_version,
          server_version, result_data
        ) VALUES (
          ${mutation.clientId}, ${mutation.table}, ${mutation.recordId},
          ${mutation.clientVersion}, ${serverVersion},
          ${resultData ? JSON.stringify(resultData) : null}::jsonb
        )`,
      );

      results.push({
        table: mutation.table,
        recordId: mutation.recordId,
        status: 'applied',
        serverVersion,
        data: resultData,
      });
    }

    return results;
  }

  /**
   * Delta sync: for each table, return records with sync_version > requested version.
   */
  async pull(tables: Record<string, number>, _callerId?: string) {
    const deltas: Record<string, unknown[]> = {};

    for (const [table, sinceVersion] of Object.entries(tables)) {
      if (!SYNCABLE_TABLES.has(table)) {
        continue;
      }

      // Add user-scoped WHERE clause for tables with ownership
      let ownerFilter = sql``;
      if (_callerId && table === 'trips') {
        ownerFilter = sql` AND (driver_id = ${_callerId}::uuid OR loader_operator_id = ${_callerId}::uuid)`;
      } else if (_callerId && (table === 'bale_productions' || table === 'fuel_logs' || table === 'consumable_logs' || table === 'bale_loads')) {
        ownerFilter = sql` AND operator_id = ${_callerId}::uuid`;
      }

      const result = await this.drizzleProvider.db.execute(
        sql`SELECT * FROM ${sql.raw(`"${table}"`)}
            WHERE sync_version > ${sinceVersion} ${ownerFilter}
            ORDER BY sync_version ASC
            LIMIT 1000`,
      );
      deltas[table] = result as unknown as unknown[];
    }

    return {
      deltas,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Return last processed version per table for a given client.
   */
  async status(clientId: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT table_name, MAX(server_version) as last_version
          FROM sync_idempotency
          WHERE client_id = ${clientId}
          GROUP BY table_name`,
    );
    const rows = result as unknown as {
      table_name: string;
      last_version: number;
    }[];

    const status: Record<string, number> = {};
    for (const row of rows) {
      status[row.table_name] = row.last_version;
    }

    return { clientId, tables: status };
  }
}
