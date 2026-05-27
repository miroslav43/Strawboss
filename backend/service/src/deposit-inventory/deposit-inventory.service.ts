import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

/**
 * Plan C — read-only view of a depot's current inventory + incoming trucks.
 * Consumed by the new mobile `(deposit)` role group and (eventually) the
 * admin reports tab. Inventory is computed from completed trip bale counts
 * matched to the depot's coords (50 m radius); incoming is the set of
 * in_transit/arrived trips whose destination is within 5 km of the depot.
 */
@Injectable()
export class DepositInventoryService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async listDepotsForOrg(orgId: string | null, userId?: string, userRole?: string) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    if (userRole === 'depot_manager' && userId) {
      conditions.push(sql`id = (
        SELECT assigned_delivery_destination_id FROM users
        WHERE id = ${userId}::uuid AND deleted_at IS NULL
      )`);
    }
    const where = sql.join(conditions, sql` AND `);
    const rows = await this.drizzleProvider.db.execute(sql`
      SELECT id, code, name, address,
             ST_AsGeoJSON(coords) AS "coordsGeoJson"
        FROM delivery_destinations
       WHERE ${where}
       ORDER BY name ASC
    `);
    return rows;
  }

  async getInventory(depotId: string, orgId: string | null) {
    // Verify depot exists + scope.
    const checkConditions: ReturnType<typeof sql>[] = [
      sql`id = ${depotId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) checkConditions.push(sql`organization_id = ${orgId}::uuid`);
    const checkWhere = sql.join(checkConditions, sql` AND `);
    const depot = (await this.drizzleProvider.db.execute(sql`
      SELECT id, code, name, address, ST_AsGeoJSON(coords) AS "coordsGeoJson"
        FROM delivery_destinations
       WHERE ${checkWhere}
       LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!depot.length) throw new NotFoundException('Depot not found');

    // Aggregate completed trips whose destination is within 50 m of the depot.
    const tripScopeConditions: ReturnType<typeof sql>[] = [
      sql`t.deleted_at IS NULL`,
      sql`t.status = 'completed'::trip_status`,
      sql`t.destination_coords IS NOT NULL`,
      sql`ST_DWithin(t.destination_coords::geography, dd.coords::geography, 50)`,
    ];
    if (orgId !== null) tripScopeConditions.push(sql`t.organization_id = ${orgId}::uuid`);
    const tripScopeWhere = sql.join(tripScopeConditions, sql` AND `);

    const inv = (await this.drizzleProvider.db.execute(sql`
      SELECT
        COALESCE(SUM(t.bale_count), 0)::int                                AS "totalBales",
        COALESCE(SUM(GREATEST(COALESCE(t.gross_weight_kg, 0) - COALESCE(t.tare_weight_kg, 0), 0)), 0)::int AS "totalNetWeightKg",
        MAX(t.completed_at)                                                AS "lastUpdate"
        FROM trips t
        JOIN delivery_destinations dd
          ON dd.id = ${depotId}::uuid
       WHERE ${tripScopeWhere}
    `)) as unknown as Record<string, unknown>[];

    // Incoming trips: status in_transit or arrived, dest within 5 km.
    const incomingConditions: ReturnType<typeof sql>[] = [
      sql`t.deleted_at IS NULL`,
      sql`t.status IN ('in_transit'::trip_status, 'arrived'::trip_status, 'delivering'::trip_status)`,
      sql`t.destination_coords IS NOT NULL`,
      sql`ST_DWithin(t.destination_coords::geography, dd.coords::geography, 5000)`,
    ];
    if (orgId !== null) incomingConditions.push(sql`t.organization_id = ${orgId}::uuid`);
    const incomingWhere = sql.join(incomingConditions, sql` AND `);

    const incoming = await this.drizzleProvider.db.execute(sql`
      SELECT
        t.id                            AS "tripId",
        t.trip_number                   AS "tripNumber",
        t.status,
        t.bale_count                    AS "baleCount",
        t.iteration_index               AS "iterationIndex",
        m.registration_plate            AS "truckPlate",
        m.internal_code                 AS "truckCode",
        u.full_name                     AS "driverName"
      FROM trips t
      JOIN delivery_destinations dd ON dd.id = ${depotId}::uuid
      LEFT JOIN machines m ON m.id = t.truck_id
      LEFT JOIN users u ON u.id = t.driver_id
      WHERE ${incomingWhere}
      ORDER BY t.departure_at ASC NULLS LAST
      LIMIT 50
    `);

    return {
      depot: depot[0],
      inventory: inv[0] ?? {
        totalBales: 0,
        totalNetWeightKg: 0,
        lastUpdate: null,
      },
      incoming,
    };
  }

  async ensureUserCanAccessDepot(
    userId: string,
    depotId: string,
    orgId: string | null,
    userRole?: string,
  ): Promise<void> {
    if (userRole === 'depot_manager') {
      // depot_manager may only access their assigned depot.
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT u.assigned_delivery_destination_id
          FROM users u
         WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL
         LIMIT 1
      `)) as unknown as { assigned_delivery_destination_id: string | null }[];
      const assignedId = rows[0]?.assigned_delivery_destination_id ?? null;
      if (assignedId !== depotId) {
        throw new ForbiddenException('You can only access your assigned depot');
      }
      return;
    }
    // Other roles: any authenticated user inside the org may read.
    const depotConditions: ReturnType<typeof sql>[] = [
      sql`id = ${depotId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) depotConditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(depotConditions, sql` AND `);
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id FROM delivery_destinations WHERE ${where} LIMIT 1`,
    )) as unknown as { id: string }[];
    if (!rows.length) {
      throw new ForbiddenException('Depot not found in your organization');
    }
  }
}
