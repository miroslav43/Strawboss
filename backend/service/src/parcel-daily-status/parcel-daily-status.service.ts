import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ParcelsService } from '../parcels/parcels.service';

@Injectable()
export class ParcelDailyStatusService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly parcelsService: ParcelsService,
  ) {}

  async listByDate(date: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        id,
        parcel_id as "parcelId",
        status_date as "statusDate",
        is_done as "isDone",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM parcel_daily_status
      WHERE status_date = ${date}
      ORDER BY parcel_id`,
    );
    return result;
  }

  async upsert(dto: {
    parcelId: string;
    statusDate: string;
    isDone: boolean;
    notes?: string | null;
  }) {
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
    );

    return result;
  }

  /** Remove planning row for a parcel on a date (clears empty “stuck” parcel shells). */
  async removeForDate(parcelId: string, statusDate: string) {
    await this.drizzleProvider.db.execute(
      sql`DELETE FROM parcel_daily_status
          WHERE parcel_id = ${parcelId} AND status_date = ${statusDate}`,
    );
  }
}
