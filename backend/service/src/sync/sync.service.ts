import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { SyncMutation, SyncResult, SyncResponse, SyncTombstone } from '@strawboss/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

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
    'id',
    'bale_count',
    'departure_at',
    'arrival_at',
    'delivered_at',
    'completed_at',
    'cancelled_at',
    'destination_name',
    'destination_address',
    'gross_weight_kg',
    'tare_weight_kg',
    'weight_ticket_number',
    'weight_ticket_photo_url',
    'delivery_notes',
    'receiver_name',
    'receiver_signature_url',
    'receiver_signed_at',
    'cancellation_reason',
    'fraud_flags',
    'gps_distance_km',
    'source_parcel_id',
    'truck_id',
    'loader_id',
    'driver_id',
    'loader_operator_id',
    'loading_started_at',
    'loading_completed_at',
    'iteration_index',
    'client_id',
    'sync_version',
  ]),
  bale_loads: new Set([
    'id',
    'trip_id',
    'parcel_id',
    'loader_id',
    'operator_id',
    'bale_count',
    'loaded_at',
    'gps_lat',
    'gps_lon',
    'notes',
    'farmtrack_event_id',
    'client_id',
    'sync_version',
  ]),
  bale_productions: new Set([
    'id',
    'parcel_id',
    'baler_id',
    'operator_id',
    'production_date',
    'bale_count',
    'avg_bale_weight_kg',
    'start_time',
    'end_time',
    'farmtrack_session_id',
    'updated_at',
    'sync_version',
  ]),
  fuel_logs: new Set([
    'id',
    'machine_id',
    'operator_id',
    'parcel_id',
    'logged_at',
    'fuel_type',
    'quantity_liters',
    'unit_price',
    'total_cost',
    'hourmeter_hrs',
    'is_full_tank',
    'receipt_photo_url',
    'notes',
    'client_id',
    'sync_version',
  ]),
  consumable_logs: new Set([
    'id',
    'machine_id',
    'operator_id',
    'parcel_id',
    'consumable_type',
    'description',
    'quantity',
    'unit',
    'unit_price',
    'total_cost',
    'logged_at',
    'receipt_photo_url',
    'updated_at',
    'client_id',
    'sync_version',
  ]),
  task_assignments: new Set([
    'id',
    'assignment_date',
    'machine_id',
    'parcel_id',
    'assigned_user_id',
    'priority',
    'sequence_order',
    'status',
    'parent_assignment_id',
    'destination_id',
    'estimated_start',
    'estimated_end',
    'actual_start',
    'actual_end',
    'notes',
    'updated_at',
    'sync_version',
  ]),
  machines: new Set([
    'id',
    'machine_type',
    'registration_plate',
    'internal_code',
    'make',
    'model',
    'year',
    'fuel_type',
    'tank_capacity_liters',
    'current_hourmeter_hrs',
    'max_payload_kg',
    'max_bale_count',
    'tare_weight_kg',
    'bales_per_hour_avg',
    'bale_weight_avg_kg',
    'reach_meters',
    'farmtrack_device_id',
    'sync_version',
  ]),
  parcels: new Set([
    'id',
    'code',
    'name',
    'owner_name',
    'owner_contact',
    'area_hectares',
    'boundary',
    'centroid',
    'address',
    'municipality',
    'notes',
    'harvest_status',
    'crop_type',
    'farmtrack_geofence_id',
    'farm_id',
    'sync_version',
  ]),
};

// NOTE: 'organization_id' is intentionally absent from ALLOWED_COLUMNS.
// It is injected server-side after column validation to prevent mobile
// clients from overriding or spoofing their organization scope.

/**
 * Column(s) recording which user "owns" a row, per syncable table. Used by
 * applyMutation to ensure only the owning operator (or an elevated role) can
 * UPDATE/DELETE a record, and that INSERT payloads cannot attribute a row to
 * a different user. A row is considered owned by the caller if ANY listed
 * column matches (e.g. a trip is owned by either its driver or its loader
 * operator). Tables absent from this map (machines, parcels) carry no
 * per-user ownership concept — org membership (already enforced by the org
 * guard on every write) is the only scope that applies.
 */
const OWNER_COLUMNS: Record<string, string[]> = {
  trips: ['driver_id', 'loader_operator_id'],
  bale_loads: ['operator_id'],
  bale_productions: ['operator_id'],
  fuel_logs: ['operator_id'],
  consumable_logs: ['operator_id'],
  task_assignments: ['assigned_user_id'],
};

/** Roles that may write/mutate any org member's rows (dispatch/ops staff). */
const ELEVATED_SYNC_ROLES = new Set(['admin', 'dispatcher', 'depot_manager']);

/**
 * Foreign-key columns whose value must belong to the caller's organization.
 * Enforced before INSERT so a mobile client cannot stitch references across
 * tenants (e.g. a bale_load whose parcel_id lives in another org).
 *
 * Keys not listed here are treated as opaque (e.g. `client_id` is the local
 * UUID identifier, not a database foreign key).
 */
const FK_ORG_CHECKS: Record<string, Record<string, string>> = {
  trips: {
    source_parcel_id: 'parcels',
    truck_id: 'machines',
    loader_id: 'machines',
    driver_id: 'users',
    loader_operator_id: 'users',
  },
  bale_loads: {
    trip_id: 'trips',
    parcel_id: 'parcels',
    loader_id: 'machines',
    operator_id: 'users',
  },
  bale_productions: {
    parcel_id: 'parcels',
    baler_id: 'machines',
    operator_id: 'users',
  },
  fuel_logs: {
    machine_id: 'machines',
    operator_id: 'users',
    parcel_id: 'parcels',
  },
  consumable_logs: {
    machine_id: 'machines',
    operator_id: 'users',
    parcel_id: 'parcels',
  },
  task_assignments: {
    machine_id: 'machines',
    parcel_id: 'parcels',
    assigned_user_id: 'users',
    parent_assignment_id: 'task_assignments',
    destination_id: 'delivery_destinations',
  },
  parcels: {
    farm_id: 'farms',
  },
  machines: {},
};

/**
 * Explicit column projection for delta pull, per table.
 *
 * The mobile SQLite schema is a subset of the server schema. `SELECT *` would
 * return server-only columns (organization_id, geometry, fraud_flags, ...) that
 * the local `trips` table lacks, and TripsRepo.upsert builds its INSERT from
 * Object.keys(row) — so an unknown column crashes the upsert. Projecting to
 * exactly the columns the mobile schema knows keeps pull safe. `id` and
 * `sync_version` are always required (record id + delta cursor).
 */
const PULL_COLUMNS: Record<string, string[]> = {
  trips: [
    'id',
    'trip_number',
    'status',
    'source_parcel_id',
    'destination_id',
    'destination_name',
    'destination_address',
    'truck_id',
    'driver_id',
    'loader_id',
    'loader_operator_id',
    'bale_count',
    'gross_weight_kg',
    'tare_weight_kg',
    'receiver_name',
    'loading_started_at',
    'loading_completed_at',
    'departure_at',
    'arrival_at',
    'delivered_at',
    'completed_at',
    'depot_operator_id',
    'depot_confirmed_at',
    'depot_operator_signature_url',
    'scale_broken',
    'parent_trip_id',
    'iteration_index',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  bale_loads: [
    'id',
    'trip_id',
    'parcel_id',
    'loader_id',
    'operator_id',
    'bale_count',
    'loaded_at',
    'gps_lat',
    'gps_lon',
    'notes',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  bale_productions: [
    'id',
    'parcel_id',
    'baler_id',
    'operator_id',
    'production_date',
    'bale_count',
    'avg_bale_weight_kg',
    'start_time',
    'end_time',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  fuel_logs: [
    'id',
    'machine_id',
    'operator_id',
    'parcel_id',
    'logged_at',
    'fuel_type',
    'quantity_liters',
    'hourmeter_hrs',
    'is_full_tank',
    'receipt_photo_url',
    'notes',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  consumable_logs: [
    'id',
    'machine_id',
    'operator_id',
    'parcel_id',
    'consumable_type',
    'quantity',
    'unit',
    'logged_at',
    'receipt_photo_url',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  task_assignments: [
    'id',
    'assignment_date',
    'machine_id',
    'parcel_id',
    'assigned_user_id',
    'priority',
    'sequence_order',
    'estimated_start',
    'estimated_end',
    'actual_start',
    'actual_end',
    'notes',
    'created_at',
    'updated_at',
    'sync_version',
  ],
  // `boundary` and `centroid` (PostGIS geometry) are intentionally excluded —
  // raw projection would surface WKB hex that the mobile layer cannot parse.
  // Geometry continues to be served through the REST parcels endpoint
  // (useCachedParcels), which serialises via ST_AsGeoJSON.
  parcels: [
    'id',
    'code',
    'name',
    'area_hectares',
    'municipality',
    'harvest_status',
    'crop_type',
    // Denormalized owning-farm name (00065) — lets the mobile field card show the
    // farm offline. A farm rename re-stamps the parcel's sync_version so it pulls.
    'farm_name',
    'created_at',
    'updated_at',
    'sync_version',
  ],
};

function validateColumnName(table: string, column: string): void {
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed || !allowed.has(column)) {
    throw new BadRequestException(`Column '${column}' is not allowed for sync on table '${table}'`);
  }
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * For every FK column declared in FK_ORG_CHECKS for `table` that is present
   * in `data` with a non-null UUID value, verify the referenced row lives in
   * the caller's organization. Throws BadRequestException on first mismatch.
   */
  private async validateForeignKeyOrgs(
    table: string,
    data: Record<string, unknown>,
    orgId: string,
  ): Promise<void> {
    const fkMap = FK_ORG_CHECKS[table];
    if (!fkMap) return;

    for (const [column, referencedTable] of Object.entries(fkMap)) {
      const value = data[column];
      if (value === null || value === undefined) continue;
      if (!isUuid(value)) continue;

      const result = await this.drizzleProvider.db.execute(
        sql`SELECT 1 FROM ${sql.raw(`"${referencedTable}"`)}
            WHERE id = ${value}::uuid
              AND organization_id = ${orgId}::uuid
              AND deleted_at IS NULL
            LIMIT 1`,
      );
      const rows = result as unknown as unknown[];
      if (rows.length === 0) {
        throw new BadRequestException(
          `Foreign key '${column}' references ${referencedTable}/${value} outside caller's organization`,
        );
      }
    }
  }

  private isElevatedSyncRole(callerRole?: string): boolean {
    return !!callerRole && ELEVATED_SYNC_ROLES.has(callerRole);
  }

  /**
   * For UPDATE/DELETE: fetch the existing row's owner column(s) and reject
   * unless the caller is the owner (equals ANY listed owner column) or holds
   * an elevated role. A row whose owner column(s) are all NULL (e.g. an
   * unassigned truck task_assignment, where the real owner lives on
   * trips.driver_id instead) has no per-user ownership to verify — the org
   * guard folded into the write's WHERE clause is the only scope that
   * applies. Missing/foreign-org rows are left for the write itself (and its
   * own org guard) to reject, so the error message stays consistent.
   */
  private async assertOwnership(
    table: string,
    recordId: string,
    orgId: string | null,
    callerId: string,
    callerRole: string | undefined,
  ): Promise<void> {
    const ownerColumns = OWNER_COLUMNS[table];
    if (!ownerColumns || ownerColumns.length === 0) return;
    if (this.isElevatedSyncRole(callerRole)) return;

    const colsSql = sql.raw(ownerColumns.map((c) => `"${c}"`).join(', '));
    const orgGuard = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT ${colsSql} FROM ${sql.raw(`"${table}"`)}
          WHERE id = ${recordId}${orgGuard}
          LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return;

    const ownerValues = ownerColumns
      .map((c) => row[c])
      .filter((v): v is string => v !== null && v !== undefined);
    if (ownerValues.length === 0) return;

    if (!ownerValues.includes(callerId)) {
      throw new BadRequestException(
        `Record ${recordId} in table '${table}' is not owned by the caller`,
      );
    }
  }

  /**
   * For INSERT: reject a payload that attributes a row's owner column to a
   * user other than the caller, unless the caller holds an elevated role.
   */
  private assertInsertOwnership(
    table: string,
    data: Record<string, unknown>,
    callerId: string,
    callerRole: string | undefined,
  ): void {
    const ownerColumns = OWNER_COLUMNS[table];
    if (!ownerColumns || ownerColumns.length === 0) return;
    if (this.isElevatedSyncRole(callerRole)) return;

    for (const column of ownerColumns) {
      const value = data[column];
      if (value !== null && value !== undefined && value !== callerId) {
        throw new BadRequestException(
          `Cannot set '${column}' to another user on insert into '${table}'`,
        );
      }
    }
  }

  /**
   * Process a batch of offline mutations with idempotency.
   *
   * Each mutation is processed in isolation: a failure in one mutation
   * does NOT abort the batch. Instead, we return `status: 'failed'` with
   * an `error` message so the mobile client can mark that specific queue
   * entry as failed while letting the rest of the batch succeed.
   */
  async push(
    mutations: SyncMutation[],
    callerId: string,
    orgId: string | null = null,
    callerRole?: string,
  ): Promise<SyncResult[]> {
    // The "no org filter" branch below is reachable ONLY for an explicit
    // super_admin caller. A missing/null orgId for anyone else — including
    // elevated org roles (admin/dispatcher/depot_manager), or a forged/stale
    // identity that slipped past the guards — is rejected outright rather
    // than silently falling through to "no filter" (i.e. every org).
    if (callerRole !== 'super_admin' && !orgId) {
      throw new ForbiddenException('Missing organization context');
    }

    const results: SyncResult[] = [];

    for (const mutation of mutations) {
      try {
        results.push(await this.applyMutation(mutation, orgId, callerId, callerRole));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `push mutation failed: table=${mutation.table} record=${mutation.recordId} ${message}`,
        );
        results.push({
          table: mutation.table,
          recordId: mutation.recordId,
          status: 'failed',
          serverVersion: 0,
          data: null,
          error: message,
        });
      }
    }

    return results;
  }

  private async applyMutation(
    mutation: SyncMutation,
    orgId: string | null,
    callerId: string,
    callerRole: string | undefined,
  ): Promise<SyncResult> {
    if (!SYNCABLE_TABLES.has(mutation.table)) {
      throw new BadRequestException(`Table '${mutation.table}' is not syncable`);
    }

    // The server schema uses `uuid` primary keys; reject early with a clear
    // message so the client can stop retrying invalid rows generated by old
    // builds of the mobile app.
    if (!isUuid(mutation.recordId)) {
      throw new BadRequestException(`recordId '${mutation.recordId}' is not a valid UUID`);
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
      return {
        table: mutation.table,
        recordId: mutation.recordId,
        status: 'skipped',
        serverVersion: existingRows[0].server_version as number,
        data: existingRows[0].result_data as Record<string, unknown> | null,
      };
    }

    // 2. Apply the mutation
    let resultData: Record<string, unknown> | null = null;
    let serverVersion = 0;

    if (mutation.action === 'insert') {
      // Build validated data first (column allowlist check).
      // sync_version is assigned by the set_sync_version() DB trigger.
      const insertData: Record<string, unknown> = { ...mutation.data };
      delete insertData.sync_version;
      for (const col of Object.keys(insertData)) {
        validateColumnName(mutation.table, col);
      }

      // Ownership guard: a mobile client cannot attribute a new row to a
      // different user's owner column (e.g. insert a bale_load with someone
      // else's operator_id) unless the caller holds an elevated role.
      this.assertInsertOwnership(mutation.table, insertData, callerId, callerRole);

      // Cross-org FK guard: every foreign-key value referenced by this row
      // must point at a row in the same organization as the caller. Without
      // this, a mobile client could create rows that stitch tenants together.
      if (orgId !== null) {
        await this.validateForeignKeyOrgs(mutation.table, insertData, orgId);
      }

      // Inject organization_id server-side AFTER validation so mobile clients
      // cannot spoof it, and it never passes through the column allowlist check.
      if (orgId !== null && SYNCABLE_TABLES.has(mutation.table)) {
        insertData.organization_id = orgId;
      }

      const finalColumns = Object.keys(insertData);
      const values = Object.values(insertData);

      const colsSql = sql.raw(finalColumns.map((c) => `"${c}"`).join(', '));
      const placeholders = values.map((v) =>
        typeof v === 'object' && v !== null ? sql`${JSON.stringify(v)}::jsonb` : sql`${v}`,
      );
      const valsSql = sql.join(placeholders, sql`, `);

      const insertResult = await this.drizzleProvider.db.execute(
        sql`INSERT INTO ${sql.raw(`"${mutation.table}"`)} (${colsSql})
            VALUES (${valsSql})
            RETURNING *`,
      );
      const rows = insertResult as unknown as Record<string, unknown>[];
      resultData = rows[0] ?? null;
      serverVersion = Number(resultData?.sync_version ?? 0);

      // Side-effect: when a bale_load lands via sync, keep the parent trip's
      // bale_count aggregate in sync with the loads (mirrors the behaviour of
      // BaleLoadsService.create when posted via the REST endpoint).
      if (mutation.table === 'bale_loads') {
        const tripId = resultData?.trip_id as string | null | undefined;
        if (tripId) {
          const tripOrgFilter = orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``;
          await this.drizzleProvider.db.execute(
            sql`UPDATE trips SET
                  bale_count = (
                    SELECT COALESCE(SUM(bale_count), 0)::int
                    FROM bale_loads
                    WHERE trip_id = ${tripId} AND deleted_at IS NULL
                  ),
                  updated_at = NOW()
                WHERE id = ${tripId} ${tripOrgFilter}`,
          );
        }
      }
    } else if (mutation.action === 'update') {
      // Ownership guard: only the owning operator (or an elevated role) may
      // update this record — prevents e.g. driver A editing driver B's trip.
      await this.assertOwnership(mutation.table, mutation.recordId, orgId, callerId, callerRole);

      // sync_version is bumped by the set_sync_version() DB trigger.
      if (orgId !== null) {
        await this.validateForeignKeyOrgs(mutation.table, mutation.data, orgId);
      }
      const setClauses: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];
      for (const [key, value] of Object.entries(mutation.data)) {
        if (key !== 'id' && key !== 'sync_version' && key !== 'updated_at') {
          validateColumnName(mutation.table, key);
          if (typeof value === 'object' && value !== null) {
            setClauses.push(sql`${sql.raw(`"${key}"`)} = ${JSON.stringify(value)}::jsonb`);
          } else {
            setClauses.push(sql`${sql.raw(`"${key}"`)} = ${value}`);
          }
        }
      }

      const setClause = sql.join(setClauses, sql`, `);
      // Org filter is folded into WHERE so the check is atomic with the write
      // (no TOCTOU window between guard SELECT and UPDATE).
      const orgGuard = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
      const updateResult = await this.drizzleProvider.db.execute(
        sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
            SET ${setClause}
            WHERE id = ${mutation.recordId}${orgGuard}
            RETURNING *`,
      );
      const rows = updateResult as unknown as Record<string, unknown>[];
      if (rows.length === 0 && orgId !== null) {
        throw new BadRequestException(
          `Record ${mutation.recordId} does not belong to caller's organization`,
        );
      }
      resultData = rows[0] ?? null;
      serverVersion = Number(resultData?.sync_version ?? 0);
    } else if (mutation.action === 'delete') {
      // Ownership guard: only the owning operator (or an elevated role) may
      // soft-delete this record.
      await this.assertOwnership(mutation.table, mutation.recordId, orgId, callerId, callerRole);

      // sync_version is bumped by the set_sync_version() DB trigger.
      const orgGuard = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
      const deleteResult = await this.drizzleProvider.db.execute(
        sql`UPDATE ${sql.raw(`"${mutation.table}"`)}
            SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = ${mutation.recordId}${orgGuard}
            RETURNING sync_version`,
      );
      const deleteRows = deleteResult as unknown as Record<string, unknown>[];
      if (deleteRows.length === 0 && orgId !== null) {
        throw new BadRequestException(
          `Record ${mutation.recordId} does not belong to caller's organization`,
        );
      }
      serverVersion = Number(deleteRows[0]?.sync_version ?? 0);
    }

    // 3. Record in idempotency table so future retries are fast no-ops.
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

    return {
      table: mutation.table,
      recordId: mutation.recordId,
      status: 'applied',
      serverVersion,
      data: resultData,
    };
  }

  /**
   * Delta sync: for each table, return records with sync_version > requested
   * version, as a flat `SyncResult[]` the mobile client applies row-by-row.
   *
   * sync_version is a globally monotonic value (set_sync_version() trigger), so
   * `> sinceVersion` reliably yields every change the device has not yet seen.
   */
  async pull(
    tables: Record<string, number>,
    _callerId?: string,
    orgId: string | null = null,
    supportsTombstones = false,
    callerRole?: string,
  ): Promise<SyncResponse> {
    // The "no org filter" branch below is reachable ONLY for an explicit
    // super_admin caller. A missing/null orgId for anyone else — including a
    // forged or stale identity that slipped past the guards — is rejected
    // outright rather than silently falling through to "no filter" (i.e.
    // every org's data dumped to the caller).
    if (callerRole !== 'super_admin' && !orgId) {
      throw new ForbiddenException('Missing organization context');
    }

    const results: SyncResult[] = [];
    const deletions: SyncTombstone[] = [];

    // Feature-flag the tombstone branch so we can revert to today's legacy
    // behaviour instantly without redeploy if anything misbehaves in prod.
    const tombstonesEnabled =
      supportsTombstones && process.env.STRAWBOSS_SYNC_TOMBSTONES_ENABLED !== 'false';

    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;

    // Tables that carry a deleted_at column and must be filtered.
    const TABLES_WITH_SOFT_DELETE = new Set([
      'trips',
      'bale_loads',
      'bale_productions',
      'fuel_logs',
      'consumable_logs',
      'task_assignments',
      'parcels',
      'machines',
    ]);

    for (const [table, sinceVersion] of Object.entries(tables)) {
      if (!SYNCABLE_TABLES.has(table)) {
        continue;
      }
      const pullColumns = PULL_COLUMNS[table];
      if (!pullColumns) {
        continue;
      }

      // Add user-scoped WHERE clause for tables with ownership
      let ownerFilter = sql``;
      if (_callerId && table === 'trips') {
        if (callerRole === 'depot_manager') {
          const userOrgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
          ownerFilter = sql` AND destination_id = (
            SELECT assigned_delivery_destination_id FROM users
            WHERE id = ${_callerId}::uuid AND deleted_at IS NULL${userOrgFilter}
          )`;
        } else {
          ownerFilter = sql` AND (driver_id = ${_callerId}::uuid OR loader_operator_id = ${_callerId}::uuid)`;
        }
      } else if (
        _callerId &&
        (table === 'bale_loads' ||
          table === 'bale_productions' ||
          table === 'fuel_logs' ||
          table === 'consumable_logs')
      ) {
        ownerFilter = sql` AND operator_id = ${_callerId}::uuid`;
      }

      const isSoftDeleteTable = TABLES_WITH_SOFT_DELETE.has(table);
      // Legacy clients keep getting the original filter (no deleted rows ever).
      // New clients (capability header) see soft-deleted rows so we can emit
      // them as tombstones below.
      const softDeleteFilter =
        isSoftDeleteTable && !tombstonesEnabled ? sql` AND deleted_at IS NULL` : sql``;

      // Build the column projection. When emitting tombstones we additionally
      // need `deleted_at` so we can partition live rows vs deletions.
      const projectedColumns =
        isSoftDeleteTable && tombstonesEnabled ? [...pullColumns, 'deleted_at'] : pullColumns;
      // projectedColumns is built from hard-coded constants — safe to sql.raw.
      const colsSql = sql.raw(projectedColumns.map((c) => `"${c}"`).join(', '));
      // trips carry a computed read-model flag: does the destination depot have a
      // depot_manager assigned? Drives the driver app's read-only delivery view.
      // It is NOT a stored column, so it is appended as an expression here rather
      // than listed in PULL_COLUMNS (the mobile trips schema mirrors it).
      const extraSelect =
        table === 'trips'
          ? sql`, EXISTS(
              SELECT 1 FROM users du
              WHERE du.assigned_delivery_destination_id = "trips".destination_id
                AND du.organization_id = "trips".organization_id
                AND du.role = 'depot_manager'::user_role
                AND du.deleted_at IS NULL
            ) AS destination_has_operator`
          : sql``;
      // Delta by version, EXCEPT for trips: always include the caller's active
      // (non-terminal) trips regardless of the cursor. sync_version is stamped by
      // a global sequence in a BEFORE-UPDATE trigger, so two rows updated in the
      // same instant can commit out of order — a lower-versioned trip committing
      // after a higher-versioned one the device already pulled. With a pure
      // `> cursor` delta that lower-versioned active trip is skipped forever
      // (observed: an in_transit trip at v21890 stranded behind a completed trip
      // at v21891). Re-sending active trips every pull (1–2 rows per driver)
      // makes that impossible; completed/cancelled history stays delta-only.
      const versionFilter =
        table === 'trips'
          ? sql`(sync_version > ${sinceVersion} OR status NOT IN ('completed', 'cancelled'))`
          : sql`sync_version > ${sinceVersion}`;
      const result = await this.drizzleProvider.db.execute(
        sql`SELECT ${colsSql}${extraSelect} FROM ${sql.raw(`"${table}"`)}
            WHERE ${versionFilter} ${ownerFilter}${softDeleteFilter}${orgFilter}
            ORDER BY sync_version ASC
            LIMIT 1000`,
      );
      const rows = result as unknown as Record<string, unknown>[];

      let liveCount = 0;
      let tombstoneCount = 0;

      for (const row of rows) {
        const deletedAt = row.deleted_at;
        const serverVersion = Number(row.sync_version ?? 0);

        // Tombstone path: only for clients that advertised the capability AND
        // tables that actually carry `deleted_at`. Older clients never reach
        // this branch because soft-deleted rows are filtered out above.
        if (isSoftDeleteTable && tombstonesEnabled && deletedAt != null) {
          deletions.push({
            table,
            recordId: row.id as string,
            serverVersion,
            deletedAt: deletedAt instanceof Date ? deletedAt.toISOString() : (deletedAt as string),
          });
          tombstoneCount++;
          continue;
        }

        // Live row path (unchanged). `sync_version` is surfaced via
        // `serverVersion` and `deleted_at` must NOT leak into `data` — the
        // mobile SQLite schema is a subset and would crash the upsert.
        const data = { ...row };
        delete data.sync_version;
        delete data.deleted_at;
        results.push({
          table,
          recordId: row.id as string,
          status: 'applied',
          serverVersion,
          data,
        });
        liveCount++;
      }

      if (rows.length > 0) {
        this.logger.log(
          `sync pull: table=${table} since=${sinceVersion} returned=${liveCount} tombstones=${tombstoneCount}`,
        );
      }
    }

    return {
      results,
      serverTime: new Date().toISOString(),
      // Omit `deletions` entirely for legacy clients so the wire shape stays
      // byte-identical to today's response.
      ...(tombstonesEnabled ? { deletions } : {}),
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
