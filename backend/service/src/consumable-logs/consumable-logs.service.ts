import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class ConsumableLogsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: { machineId?: string; parcelId?: string }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.machineId) {
      conditions.push(sql`machine_id = ${filters.machineId}`);
    }
    if (filters?.parcelId) {
      conditions.push(sql`parcel_id = ${filters.parcelId}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM consumable_logs WHERE ${where} ORDER BY logged_at DESC`,
    );
    return result;
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO consumable_logs (
        machine_id, operator_id, parcel_id, consumable_type,
        description, quantity, unit, unit_price, total_cost, logged_at
      ) VALUES (
        ${dto.machineId}, ${dto.operatorId}, ${dto.parcelId ?? null},
        ${dto.consumableType}, ${dto.description ?? null},
        ${dto.quantity}, ${dto.unit},
        ${dto.unitPrice ?? null}, ${dto.totalCost ?? null},
        ${dto.loggedAt}
      ) RETURNING *`,
    );
    return result;
  }
}
