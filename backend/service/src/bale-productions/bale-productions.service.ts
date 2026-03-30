import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class BaleProductionsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: {
    operatorId?: string;
    parcelId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.operatorId) {
      conditions.push(sql`operator_id = ${filters.operatorId}`);
    }
    if (filters?.parcelId) {
      conditions.push(sql`parcel_id = ${filters.parcelId}`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`production_date >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`production_date <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        id,
        parcel_id AS "parcelId",
        baler_id AS "balerId",
        operator_id AS "operatorId",
        production_date AS "productionDate",
        bale_count AS "baleCount",
        avg_bale_weight_kg AS "avgBaleWeightKg",
        start_time AS "startTime",
        end_time AS "endTime",
        farmtrack_session_id AS "farmtrackSessionId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM bale_productions
      WHERE ${where}
      ORDER BY production_date DESC`,
    );
    return result;
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO bale_productions (
        id, parcel_id, baler_id, operator_id,
        production_date, bale_count, avg_bale_weight_kg,
        start_time, end_time, farmtrack_session_id
      ) VALUES (
        gen_random_uuid(),
        ${dto.parcelId}, ${dto.balerId}, ${dto.operatorId},
        ${dto.productionDate}, ${dto.baleCount},
        ${dto.avgBaleWeightKg ?? null},
        ${dto.startTime ?? null}, ${dto.endTime ?? null},
        ${dto.farmtrackSessionId ?? null}
      ) RETURNING *`,
    );
    return result;
  }
}
