import { BadRequestException, Injectable } from '@nestjs/common';
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

    if (orgId) {
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

    if (orgId) {
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
    if (orgId) {
      if (dto.machineId) {
        const machineCheck = await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines
          WHERE id = ${dto.machineId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `) as unknown as { id: string }[];
        if (!machineCheck.length) throw new BadRequestException('Machine not found in your organization');
      }
      if (dto.parcelId) {
        const parcelCheck = await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels
          WHERE id = ${dto.parcelId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `) as unknown as { id: string }[];
        if (!parcelCheck.length) throw new BadRequestException('Parcel not found in your organization');
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
}
