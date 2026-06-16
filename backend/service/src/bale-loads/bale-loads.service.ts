import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class BaleLoadsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(
    orgId: string | null,
    filters?: {
      tripId?: string;
      parcelId?: string;
      operatorId?: string;
      /** ISO 8601 inclusive lower bound on loaded_at (e.g. start of today). */
      dateFrom?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    if (filters?.tripId) {
      conditions.push(sql`trip_id = ${filters.tripId}`);
    }
    if (filters?.parcelId) {
      conditions.push(sql`parcel_id = ${filters.parcelId}`);
    }
    if (filters?.operatorId) {
      conditions.push(sql`operator_id = ${filters.operatorId}::uuid`);
    }
    if (filters?.dateFrom) {
      conditions.push(sql`loaded_at >= ${filters.dateFrom}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM bale_loads WHERE ${where} ORDER BY loaded_at DESC LIMIT 1000`,
    );
    return result;
  }

  async create(orgId: string, dto: Record<string, unknown>) {
    const tripConditions: ReturnType<typeof sql>[] = [
      sql`id = ${dto.tripId}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) tripConditions.push(sql`organization_id = ${orgId}::uuid`);
    const tripWhere = sql.join(tripConditions, sql` AND `);
    const tripRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id FROM trips WHERE ${tripWhere} LIMIT 1`,
    )) as unknown as { id: string }[];
    if (!tripRows.length) {
      throw new NotFoundException('Trip-ul nu a fost găsit sau a fost șters');
    }

    // create() validated only tripId against the org. parcelId/loaderId/operatorId
    // come straight from the client DTO — validate they belong to the caller's org
    // too, mirroring TripsService.create(), so a cross-org FK can't be stitched in.
    if (orgId !== null) {
      if (dto.parcelId) {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels WHERE id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new ForbiddenException('Parcela nu a fost găsită în organizația ta');
      }
      if (dto.loaderId) {
        const loaderCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines WHERE id = ${dto.loaderId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!loaderCheck.length)
          throw new ForbiddenException('Utilajul nu a fost găsit în organizația ta');
      }
      if (dto.operatorId) {
        const opCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users WHERE id = ${dto.operatorId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!opCheck.length)
          throw new ForbiddenException('Operatorul nu a fost găsit în organizația ta');
      }
    }

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO bale_loads (
        trip_id, parcel_id, loader_id, operator_id,
        bale_count, loaded_at, gps_lat, gps_lon, notes,
        client_id, organization_id
      ) VALUES (
        ${dto.tripId}, ${dto.parcelId}, ${dto.loaderId}, ${dto.operatorId},
        ${dto.baleCount}, NOW(),
        ${dto.gpsLat ?? null}, ${dto.gpsLon ?? null},
        ${dto.notes ?? null}, ${dto.clientId ?? null},
        ${orgId}::uuid
      ) RETURNING *`,
    );

    // Auto-update trip bale count
    const tripUpdateOrgFilter = orgId ? sql`AND organization_id = ${orgId}::uuid` : sql``;
    await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        bale_count = (
          SELECT COALESCE(SUM(bale_count), 0)::int
          FROM bale_loads
          WHERE trip_id = ${dto.tripId} AND deleted_at IS NULL
        ),
        updated_at = NOW()
      WHERE id = ${dto.tripId} ${tripUpdateOrgFilter}`,
    );

    return result;
  }
}
