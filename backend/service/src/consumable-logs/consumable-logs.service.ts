import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class ConsumableLogsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async getStats(
    orgId: string | null,
    filters?: {
      operatorId?: string;
      consumableType?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.operatorId) {
      conditions.push(sql`operator_id = ${filters.operatorId}`);
    }
    if (filters?.consumableType) {
      conditions.push(sql`consumable_type = ${filters.consumableType}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        COALESCE(SUM(quantity), 0) AS "totalQuantity",
        COUNT(*) AS "entryCount",
        COALESCE(AVG(quantity), 0) AS "avgPerEntry"
      FROM consumable_logs
      WHERE ${where}`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    return rows[0];
  }

  async list(
    orgId: string | null,
    filters?: {
      machineId?: string;
      parcelId?: string;
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
    if (filters?.parcelId) {
      conditions.push(sql`parcel_id = ${filters.parcelId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`logged_at >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`logged_at <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM consumable_logs WHERE ${where} ORDER BY logged_at DESC LIMIT 1000`,
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

      if (dto.parcelId) {
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

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO consumable_logs (
        machine_id, operator_id, parcel_id, consumable_type,
        description, quantity, unit, unit_price, total_cost, logged_at,
        organization_id
      ) VALUES (
        ${dto.machineId}, ${dto.operatorId}, ${dto.parcelId ?? null},
        ${dto.consumableType}, ${dto.description ?? null},
        ${dto.quantity}, ${dto.unit},
        ${dto.unitPrice ?? null}, ${dto.totalCost ?? null},
        ${dto.loggedAt},
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }

  /**
   * Fetch one non-deleted consumable log scoped to the caller's org. Doubles as
   * the cross-org guard for update/softDelete: a foreign-org id resolves to
   * nothing and raises 404 (the privileged backend pool bypasses RLS, so org
   * isolation must live in this SQL).
   */
  async findById(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT * FROM consumable_logs WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1`,
    )) as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Consumable log ${id} not found`);
    }
    return rows[0];
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    await this.findById(id, orgId); // org-scoped existence / cross-org guard

    // machineId/operatorId/parcelId are intentionally NOT settable here — they
    // are bare cross-org FKs, omitted from updateConsumableLogSchema, so a client
    // cannot repoint a log at another organization's row.
    const set: ReturnType<typeof sql>[] = [];
    if ('loggedAt' in dto) set.push(sql`logged_at = ${dto.loggedAt as string}`);
    if ('consumableType' in dto) set.push(sql`consumable_type = ${dto.consumableType as string}`);
    if ('description' in dto)
      set.push(sql`description = ${(dto.description as string | null) ?? null}`);
    if ('quantity' in dto) set.push(sql`quantity = ${dto.quantity as number}`);
    if ('unit' in dto) set.push(sql`unit = ${dto.unit as string}`);
    if ('unitPrice' in dto) set.push(sql`unit_price = ${(dto.unitPrice as number | null) ?? null}`);
    if ('totalCost' in dto) set.push(sql`total_cost = ${(dto.totalCost as number | null) ?? null}`);

    if (set.length === 0) {
      return this.findById(id, orgId);
    }

    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE consumable_logs
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
      sql`UPDATE consumable_logs
          SET deleted_at = NOW()
          WHERE ${sql.join(conditions, sql` AND `)}
          RETURNING *`,
    );
    return (result as unknown as Record<string, unknown>[])[0];
  }
}
