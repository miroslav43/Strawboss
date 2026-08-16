import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { depotStockBales, depotStockNetWeight } from '../common/depot-stock';
import { seasonWindow } from '../common/season-range';

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
      const subConditions: ReturnType<typeof sql>[] = [
        sql`id = ${userId}::uuid`,
        sql`deleted_at IS NULL`,
      ];
      if (orgId !== null) subConditions.push(sql`organization_id = ${orgId}::uuid`);
      const subWhere = sql.join(subConditions, sql` AND `);
      conditions.push(sql`id = (
        SELECT assigned_delivery_destination_id FROM users
        WHERE ${subWhere}
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

  /**
   * @param seasonYear the season whose stock to report. Omitted means all time,
   *   i.e. exactly the pre-season behaviour.
   */
  async getInventory(depotId: string, orgId: string | null, seasonYear?: number) {
    // Verify depot exists + scope.
    const checkConditions: ReturnType<typeof sql>[] = [
      sql`id = ${depotId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) checkConditions.push(sql`organization_id = ${orgId}::uuid`);
    const checkWhere = sql.join(checkConditions, sql` AND `);
    const depot = (await this.drizzleProvider.db.execute(sql`
      SELECT id, code, name, address,
             ST_AsGeoJSON(coords) AS "coordsGeoJson",
             depot_type AS "depotType",
             confirm_radius_m AS "confirmRadiusM"
        FROM delivery_destinations
       WHERE ${checkWhere}
       LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!depot.length) throw new NotFoundException('Depot not found');

    /*
     * Stock = opening + inbound - outbound, from the ONE shared expression in
     * common/depot-stock.ts. The three copies of this formula that used to live
     * here, in DeliveryDestinationsService and in ReportsService disagreed on
     * both the join key and the status set, so the same depot could report
     * three different figures on three screens.
     *
     * Two behaviour changes came with the unification, both deliberate:
     *   * `delivered` now counts alongside `completed`. A trip sits in
     *     `delivered` until autocomplete runs, and excluding it made bales the
     *     operator was standing next to invisible on their own screen.
     *   * The season term. Stock is now "what is in the building this season",
     *     with whatever the previous season carried in as the opening balance.
     */
    const stockOpts = {
      depotIdExpr: sql`${depotId}::uuid`,
      depotCoordsExpr: sql`dd.coords`,
      orgId,
      window: seasonYear === undefined ? undefined : seasonWindow(seasonYear),
      seasonYear,
    };

    const inv = (await this.drizzleProvider.db.execute(sql`
      SELECT
        ${depotStockBales(stockOpts)}::int      AS "totalBales",
        ${depotStockNetWeight(stockOpts)}::int  AS "totalNetWeightKg",
        (
          SELECT MAX(COALESCE(t.delivered_at, t.completed_at))
            FROM trips t
           WHERE t.deleted_at IS NULL
             AND t.status IN ('delivered'::trip_status, 'completed'::trip_status)
             AND t.destination_id = ${depotId}::uuid
        )                                       AS "lastUpdate"
        FROM delivery_destinations dd
       WHERE dd.id = ${depotId}::uuid
    `)) as unknown as Record<string, unknown>[];

    /*
     * INCOMING — the trucks the operator can actually act on.
     *
     * The FK is the rule; the 5 km proximity term is a fallback for trips whose
     * destination_id is NULL. Matching purely on proximity (the old behaviour)
     * meant a trip could be listed with a live Confirm button and then fail with
     * `no_destination`, while a trip that WAS linked but had no denormalized
     * destination_coords never appeared at all — the operator staring at a truck
     * the app insisted was not there.
     *
     * Auxiliary trips are excluded from the fallback: they deliver to a
     * customer's yard, never a depot, so a NULL destination_id on one of them is
     * correct rather than missing data.
     *
     * A fallback row carries destinationLinked = false; the client only enables
     * it while its GPS genuinely places it inside the perimeter, and acting on it
     * adopts it (see TripsService.resolveDepotAction).
     */
    const incomingConditions: ReturnType<typeof sql>[] = [
      sql`t.deleted_at IS NULL`,
      sql`t.status IN ('in_transit'::trip_status, 'arrived'::trip_status, 'delivering'::trip_status)`,
      sql`(
        t.destination_id = ${depotId}::uuid
        OR (t.destination_id IS NULL
            AND t.is_auxiliary = false
            AND t.destination_coords IS NOT NULL
            AND ST_DWithin(t.destination_coords::geography, dd.coords::geography, 5000))
      )`,
    ];
    if (orgId !== null) incomingConditions.push(sql`t.organization_id = ${orgId}::uuid`);
    const incomingWhere = sql.join(incomingConditions, sql` AND `);

    // Live truck distance to the depot drives the depot-operator UI: a truck can
    // only be confirmed once it is inside the depot's confirm_radius_m. The
    // distance comes from the truck's latest GPS fix (15-min window — tolerate
    // short reporting lulls, mirrors getTrucksAtLoader); no recent fix → NULL
    // distance, not inside.
    const incoming = await this.drizzleProvider.db.execute(sql`
      SELECT
        t.id                            AS "tripId",
        t.trip_number                   AS "tripNumber",
        t.status,
        t.truck_id                      AS "truckId",
        t.bale_count                    AS "baleCount",
        t.iteration_index               AS "iterationIndex",
        m.registration_plate            AS "truckPlate",
        m.internal_code                 AS "truckCode",
        u.full_name                     AS "driverName",
        CASE WHEN ltp.coords IS NOT NULL AND dd.coords IS NOT NULL
          THEN ROUND(ST_Distance(ltp.coords::geography, dd.coords::geography)::numeric, 1)::float
          ELSE NULL END                 AS "distanceM",
        CASE WHEN ltp.coords IS NOT NULL AND dd.coords IS NOT NULL
          THEN ST_DWithin(ltp.coords::geography, dd.coords::geography, dd.confirm_radius_m)
          ELSE FALSE END                AS "isInsideGeofence",
        -- Every listed truck is actionable: the operator may start unloading one
        -- still marked in_transit, because a driver who forgot to press "Am ajuns"
        -- is not a reason to leave a truck sitting at the ramp. The operator's
        -- action stamps arrival on his behalf.
        TRUE                            AS "awaitingConfirmation",
        (t.destination_id IS NOT NULL)  AS "destinationLinked",
        t.depot_unload_started_at       AS "unloadStartedAt",
        ltp.recorded_at                 AS "lastSeenAt"
      FROM trips t
      JOIN delivery_destinations dd ON dd.id = ${depotId}::uuid
      LEFT JOIN machines m ON m.id = t.truck_id
      LEFT JOIN users u ON u.id = t.driver_id
      LEFT JOIN LATERAL (
        SELECT mle.coords, mle.recorded_at
        FROM machine_location_events mle
        WHERE mle.machine_id = t.truck_id
          AND mle.recorded_at >= NOW() - INTERVAL '15 minutes'
        ORDER BY mle.recorded_at DESC
        LIMIT 1
      ) ltp ON TRUE
      WHERE ${incomingWhere}
      ORDER BY "distanceM" ASC NULLS LAST
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
      const userConditions: ReturnType<typeof sql>[] = [
        sql`u.id = ${userId}::uuid`,
        sql`u.deleted_at IS NULL`,
      ];
      if (orgId !== null) userConditions.push(sql`u.organization_id = ${orgId}::uuid`);
      const userWhere = sql.join(userConditions, sql` AND `);
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT u.assigned_delivery_destination_id
          FROM users u
         WHERE ${userWhere}
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
