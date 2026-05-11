import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class BaleProductionsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    filters?: {
      operatorId?: string;
      parcelId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
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
      ORDER BY production_date DESC
      LIMIT 1000`,
    );
    return result;
  }

  async getStats(
    orgId: string | null,
    filters?: {
      operatorId?: string;
      parcelId?: string;
      dateFrom?: string;
      dateTo?: string;
      groupBy?: 'operator' | 'parcel' | 'date';
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`bp.deleted_at IS NULL`];

    if (orgId) {
      conditions.push(sql`bp.organization_id = ${orgId}::uuid`);
    }
    if (filters?.operatorId) {
      conditions.push(sql`bp.operator_id = ${filters.operatorId}::uuid`);
    }
    if (filters?.parcelId) {
      conditions.push(sql`bp.parcel_id = ${filters.parcelId}::uuid`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`bp.production_date >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`bp.production_date <= ${filters.dateTo}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const groupBy = filters?.groupBy ?? 'operator';

    // Build GROUP BY and SELECT based on groupBy
    let query;
    if (groupBy === 'operator') {
      query = sql`
        SELECT
          bp.operator_id AS "operatorId",
          u.full_name AS "operatorName",
          COUNT(*)::int AS "sessionCount",
          SUM(bp.bale_count)::int AS "totalBales",
          ROUND(AVG(bp.bale_count), 1)::float AS "avgBalesPerSession",
          COUNT(DISTINCT bp.parcel_id)::int AS "parcelCount"
        FROM bale_productions bp
        LEFT JOIN users u ON u.id = bp.operator_id
        WHERE ${where}
        GROUP BY bp.operator_id, u.full_name
        ORDER BY "totalBales" DESC
      `;
    } else if (groupBy === 'parcel') {
      query = sql`
        SELECT
          bp.parcel_id AS "parcelId",
          p.name AS "parcelName",
          p.code AS "parcelCode",
          COUNT(*)::int AS "sessionCount",
          SUM(bp.bale_count)::int AS "totalBales",
          ROUND(AVG(bp.bale_count), 1)::float AS "avgBalesPerSession",
          COUNT(DISTINCT bp.operator_id)::int AS "operatorCount"
        FROM bale_productions bp
        LEFT JOIN parcels p ON p.id = bp.parcel_id
        WHERE ${where}
        GROUP BY bp.parcel_id, p.name, p.code
        ORDER BY "totalBales" DESC
      `;
    } else {
      query = sql`
        SELECT
          bp.production_date AS "date",
          COUNT(*)::int AS "sessionCount",
          SUM(bp.bale_count)::int AS "totalBales",
          ROUND(AVG(bp.bale_count), 1)::float AS "avgBalesPerSession",
          COUNT(DISTINCT bp.operator_id)::int AS "operatorCount"
        FROM bale_productions bp
        WHERE ${where}
        GROUP BY bp.production_date
        ORDER BY bp.production_date DESC
      `;
    }

    return this.drizzleProvider.db.execute(query);
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    if (orgId) {
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
      if (dto.balerId) {
        const balerCheck = await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines
          WHERE id = ${dto.balerId}::uuid
            AND organization_id = ${orgId}::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `) as unknown as { id: string }[];
        if (!balerCheck.length) throw new BadRequestException('Baler machine not found in your organization');
      }
    }

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO bale_productions (
        id, parcel_id, baler_id, operator_id,
        production_date, bale_count, avg_bale_weight_kg,
        start_time, end_time, farmtrack_session_id,
        organization_id
      ) VALUES (
        gen_random_uuid(),
        ${dto.parcelId}, ${dto.balerId}, ${dto.operatorId},
        ${dto.productionDate}, ${dto.baleCount},
        ${dto.avgBaleWeightKg ?? null},
        ${dto.startTime ?? null}, ${dto.endTime ?? null},
        ${dto.farmtrackSessionId ?? null},
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }
}
