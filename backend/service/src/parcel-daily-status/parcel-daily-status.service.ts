import { Injectable, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ParcelsService } from '../parcels/parcels.service';

@Injectable()
export class ParcelDailyStatusService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly parcelsService: ParcelsService,
  ) {}

  async listByDate(date: string, orgId: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`pds.status_date = ${date}`];
    if (orgId !== null) conditions.push(sql`p.organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        pds.id,
        pds.parcel_id as "parcelId",
        pds.status_date as "statusDate",
        pds.is_done as "isDone",
        pds.notes,
        pds.created_at as "createdAt",
        pds.updated_at as "updatedAt"
      FROM parcel_daily_status pds
      JOIN parcels p ON p.id = pds.parcel_id AND p.deleted_at IS NULL
      WHERE ${where}
      ORDER BY pds.parcel_id`,
    );
    return result;
  }

  async upsert(
    orgId: string | null,
    dto: {
      parcelId: string;
      statusDate: string;
      isDone: boolean;
      notes?: string | null;
    },
  ) {
    // Verify parcel org ownership
    if (orgId !== null) {
      const parcelCheck = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM parcels
        WHERE id = ${dto.parcelId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as { id: string }[];
      if (!parcelCheck.length) {
        throw new ForbiddenException('Parcel not found in your organization');
      }
    }

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO parcel_daily_status (parcel_id, status_date, is_done, notes)
          VALUES (${dto.parcelId}, ${dto.statusDate}, ${dto.isDone}, ${dto.notes ?? null})
          ON CONFLICT (parcel_id, status_date)
          DO UPDATE SET
            is_done = ${dto.isDone},
            notes = ${dto.notes ?? null},
            updated_at = NOW()
          RETURNING
            id,
            parcel_id as "parcelId",
            status_date as "statusDate",
            is_done as "isDone",
            notes,
            created_at as "createdAt",
            updated_at as "updatedAt"`,
    );

    await this.parcelsService.applyHarvestStatusFromDailyPlan(
      dto.parcelId,
      dto.isDone,
      orgId,
    );

    return result;
  }

  /** Remove planning row for a parcel on a date (clears empty “stuck” parcel shells). */
  async removeForDate(parcelId: string, statusDate: string, orgId: string | null) {
    if (orgId !== null) {
      const parcelCheck = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM parcels
        WHERE id = ${parcelId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as { id: string }[];
      if (!parcelCheck.length) {
        throw new ForbiddenException('Parcel not found in your organization');
      }
    }
    await this.drizzleProvider.db.execute(
      sql`DELETE FROM parcel_daily_status
          WHERE parcel_id = ${parcelId} AND status_date = ${statusDate}`,
    );
  }
}
