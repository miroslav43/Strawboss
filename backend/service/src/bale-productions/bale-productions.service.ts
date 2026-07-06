import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { MachineProductionReport } from '@strawboss/types';

@Injectable()
export class BaleProductionsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    filters?: {
      operatorId?: string;
      parcelId?: string;
      balerId?: string;
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
    if (filters?.parcelId) {
      conditions.push(sql`parcel_id = ${filters.parcelId}`);
    }
    if (filters?.balerId) {
      conditions.push(sql`baler_id = ${filters.balerId}`);
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
      balerId?: string;
      dateFrom?: string;
      dateTo?: string;
      groupBy?: 'operator' | 'parcel' | 'date';
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`bp.deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`bp.organization_id = ${orgId}::uuid`);
    }
    if (filters?.operatorId) {
      conditions.push(sql`bp.operator_id = ${filters.operatorId}::uuid`);
    }
    if (filters?.parcelId) {
      conditions.push(sql`bp.parcel_id = ${filters.parcelId}::uuid`);
    }
    if (filters?.balerId) {
      conditions.push(sql`bp.baler_id = ${filters.balerId}::uuid`);
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

  /**
   * Bales produced per baler machine, each with a breakdown of the operators
   * who produced on it. One grouped query (baler_id × operator_id) assembled
   * into the nested shape the admin "Producție / mașină" tab renders.
   */
  async getMachineOperatorProduction(
    orgId: string | null,
    filters?: { dateFrom?: string; dateTo?: string },
  ): Promise<MachineProductionReport[]> {
    const conditions: ReturnType<typeof sql>[] = [sql`bp.deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`bp.organization_id = ${orgId}::uuid`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`bp.production_date >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`bp.production_date <= ${filters.dateTo}`);
    }
    const where = sql.join(conditions, sql` AND `);

    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT
        bp.baler_id AS "machineId",
        COALESCE(m.internal_code, m.registration_plate) AS "machineCode",
        bp.operator_id AS "operatorId",
        u.full_name AS "operatorName",
        SUM(bp.bale_count)::int AS "totalBales",
        COUNT(*)::int AS "sessionCount"
      FROM bale_productions bp
      LEFT JOIN machines m ON m.id = bp.baler_id
      LEFT JOIN users u ON u.id = bp.operator_id
      WHERE ${where}
      GROUP BY bp.baler_id, m.internal_code, m.registration_plate, bp.operator_id, u.full_name
      ORDER BY "totalBales" DESC
    `)) as unknown as Array<{
      machineId: string | null;
      machineCode: string | null;
      operatorId: string | null;
      operatorName: string | null;
      totalBales: number;
      sessionCount: number;
    }>;

    const byMachine = new Map<string, MachineProductionReport>();
    for (const r of rows) {
      const key = r.machineId ?? '__none__';
      let group = byMachine.get(key);
      if (!group) {
        group = {
          machineId: r.machineId ?? null,
          machineCode: r.machineCode ?? 'Fără mașină',
          totalBales: 0,
          sessionCount: 0,
          operatorCount: 0,
          operators: [],
        };
        byMachine.set(key, group);
      }
      const bales = Number(r.totalBales) || 0;
      const sessions = Number(r.sessionCount) || 0;
      group.operators.push({
        operatorId: r.operatorId ?? null,
        operatorName: r.operatorName ?? 'N/A',
        totalBales: bales,
        sessionCount: sessions,
      });
      group.totalBales += bales;
      group.sessionCount += sessions;
      group.operatorCount += 1;
    }

    return Array.from(byMachine.values()).sort((a, b) => b.totalBales - a.totalBales);
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    if (orgId !== null) {
      const parcelCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM parcels
        WHERE id = ${dto.parcelId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (!parcelCheck.length)
        throw new BadRequestException('Parcel not found in your organization');

      const balerCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${dto.balerId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (!balerCheck.length)
        throw new BadRequestException('Baler machine not found in your organization');
    }

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO bale_productions (
        id, parcel_id, baler_id, operator_id,
        production_date, bale_count, avg_bale_weight_kg,
        start_time, end_time, farmtrack_session_id,
        organization_id
      ) VALUES (
        gen_random_uuid(),
        ${dto.parcelId}, ${dto.balerId}, ${dto.operatorId ?? null},
        ${dto.productionDate}, ${dto.baleCount},
        ${dto.avgBaleWeightKg ?? null},
        ${dto.startTime ?? null}, ${dto.endTime ?? null},
        ${dto.farmtrackSessionId ?? null},
        ${orgId}::uuid
      ) RETURNING *`,
    );
    return result;
  }

  /**
   * Soft-delete one production entry (admin correcting a mistaken row from the
   * baler's web page). Scoped to the caller's org so a foreign-org id resolves
   * to nothing. The BEFORE UPDATE sync_version trigger bumps the version, so the
   * tombstone propagates to mobile on the next delta pull.
   */
  async softDelete(id: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}::uuid`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const result = (await this.drizzleProvider.db.execute(
      sql`UPDATE bale_productions
          SET deleted_at = NOW()
          WHERE ${sql.join(conditions, sql` AND `)}
          RETURNING id`,
    )) as unknown as { id: string }[];
    if (!result.length) {
      throw new NotFoundException('Bale production not found in your organization');
    }
    return result[0];
  }
}
