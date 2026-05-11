import { BadRequestException, Injectable } from '@nestjs/common';
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
      const machineCheck = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${dto.machineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as { id: string }[];
      if (!machineCheck.length) throw new BadRequestException('Machine not found in your organization');
    }

    const orgFilter = orgId ? sql`AND organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO fuel_logs (
        machine_id, operator_id, parcel_id, logged_at, fuel_type,
        quantity_liters, unit_price, total_cost, odometer_km,
        hourmeter_hrs, is_full_tank, receipt_photo_url, notes,
        client_id, sync_version, organization_id
      ) VALUES (
        ${dto.machineId}, ${dto.operatorId}, ${dto.parcelId ?? null},
        ${dto.loggedAt}, ${dto.fuelType},
        ${dto.quantityLiters}, ${dto.unitPrice ?? null},
        ${dto.totalCost ?? null}, ${dto.odometerKm ?? null},
        ${dto.hourmeterHrs ?? null}, ${dto.isFullTank},
        ${dto.receiptPhotoUrl ?? null}, ${dto.notes ?? null},
        ${dto.clientId ?? null}, 1,
        ${orgId}::uuid
      ) RETURNING *`,
    );

    // Update machine's current odometer if provided
    if (dto.odometerKm !== undefined && dto.odometerKm !== null) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE machines SET
          current_odometer_km = ${dto.odometerKm},
          updated_at = NOW()
        WHERE id = ${dto.machineId}
          AND current_odometer_km < ${dto.odometerKm}
          ${orgFilter}`,
      );
    }

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
}
