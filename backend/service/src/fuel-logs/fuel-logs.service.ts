import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class FuelLogsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async getStats(
    orgId: string | null,
    filters?: {
      operatorId?: string;
      machineId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.operatorId) {
      conditions.push(sql`operator_id = ${filters.operatorId}`);
    }
    if (filters?.machineId) {
      conditions.push(sql`machine_id = ${filters.machineId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`logged_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`logged_at <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        COALESCE(SUM(quantity_liters), 0) AS "totalLiters",
        COUNT(*) AS "entryCount",
        COALESCE(AVG(quantity_liters), 0) AS "avgLitersPerEntry"
      FROM fuel_logs
      WHERE ${where}`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    return rows[0];
  }

  async list(
    orgId: string | null,
    filters?: {
      machineId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.machineId) {
      conditions.push(sql`machine_id = ${filters.machineId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`logged_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`logged_at <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM fuel_logs WHERE ${where} ORDER BY logged_at DESC LIMIT 1000`,
    );
    return result;
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    if (orgId !== null) {
      const machineCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${dto.machineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (!machineCheck.length)
        throw new BadRequestException('Machine not found in your organization');

      // operator_id / parcel_id are bare FKs (no org column of their own), so
      // guard them the same way as machine_id to keep a caller from attaching a
      // fuel log to another organization's user or parcel.
      const operatorCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE id = ${dto.operatorId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (!operatorCheck.length)
        throw new BadRequestException('Operator not found in your organization');

      if (dto.parcelId != null) {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels
          WHERE id = ${dto.parcelId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new BadRequestException('Parcel not found in your organization');
      }
    }

    const orgFilter = orgId ? sql`AND organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO fuel_logs (
        machine_id, operator_id, parcel_id, logged_at, fuel_type,
        quantity_liters, unit_price, total_cost,
        hourmeter_hrs, is_full_tank, receipt_photo_url, notes,
        client_id, organization_id
      ) VALUES (
        ${dto.machineId}, ${dto.operatorId}, ${dto.parcelId ?? null},
        ${dto.loggedAt}, ${dto.fuelType},
        ${dto.quantityLiters}, ${dto.unitPrice ?? null},
        ${dto.totalCost ?? null},
        ${dto.hourmeterHrs ?? null}, ${dto.isFullTank},
        ${dto.receiptPhotoUrl ?? null}, ${dto.notes ?? null},
        ${dto.clientId ?? null},
        ${orgId}::uuid
      ) RETURNING *`,
    );

    // Update machine's current hourmeter if provided
    if (dto.hourmeterHrs !== undefined && dto.hourmeterHrs !== null) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE machines SET
          current_hourmeter_hrs = ${dto.hourmeterHrs},
          updated_at = NOW()
        WHERE id = ${dto.machineId}
          AND current_hourmeter_hrs < ${dto.hourmeterHrs}
          ${orgFilter}`,
      );
    }

    return result;
  }

  /**
   * Fetch one non-deleted fuel log scoped to the caller's org. Doubles as the
   * cross-org guard for update/softDelete: a foreign-org id resolves to nothing
   * and raises 404 (RLS is bypassed by the privileged backend pool, so org
   * isolation must live in this SQL).
   */
  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT * FROM fuel_logs WHERE ${where} LIMIT 1`,
    )) as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Fuel log ${id} not found`);
    }
    return rows[0];
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId); // org-scoped existence / cross-org guard

    // machineId/operatorId/parcelId are intentionally NOT settable here — they
    // are bare cross-org FKs and are omitted from updateFuelLogSchema, so a
    // client cannot repoint a log at another organization's row.
    const set: ReturnType<typeof sql>[] = [];
    if ('loggedAt' in dto) set.push(sql`logged_at = ${dto.loggedAt as string}`);
    if ('fuelType' in dto) set.push(sql`fuel_type = ${dto.fuelType as string}`);
    if ('quantityLiters' in dto) set.push(sql`quantity_liters = ${dto.quantityLiters as number}`);
    if ('unitPrice' in dto) set.push(sql`unit_price = ${(dto.unitPrice as number | null) ?? null}`);
    if ('totalCost' in dto) set.push(sql`total_cost = ${(dto.totalCost as number | null) ?? null}`);
    if ('hourmeterHrs' in dto)
      set.push(sql`hourmeter_hrs = ${(dto.hourmeterHrs as number | null) ?? null}`);
    if ('isFullTank' in dto) set.push(sql`is_full_tank = ${dto.isFullTank as boolean}`);
    if ('notes' in dto) set.push(sql`notes = ${(dto.notes as string | null) ?? null}`);
    if ('receiptPhotoUrl' in dto)
      set.push(sql`receipt_photo_url = ${(dto.receiptPhotoUrl as string | null) ?? null}`);

    if (set.length === 0) {
      return this.findById(id, orgId);
    }
    // Unlike create(), an edit deliberately does NOT advance the machine's
    // current_hourmeter_hrs — correcting a typo must never regress the counter.

    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE fuel_logs
          SET ${sql.join(set, sql`, `)}
          WHERE ${sql.join(conditions, sql` AND `)}
          RETURNING *`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);

    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    // Soft delete only — preserves the audit trail; the sync_version trigger
    // bumps the version so the tombstone propagates to mobile on next pull.
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE fuel_logs
          SET deleted_at = NOW()
          WHERE ${sql.join(conditions, sql` AND `)}
          RETURNING *`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
