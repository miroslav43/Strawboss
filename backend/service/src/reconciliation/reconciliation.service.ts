import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { reconcileBales, reconcileFuel } from '@strawboss/domain';
import type { BaleReconciliationResult, FuelReconciliationResult } from '@strawboss/domain';

@Injectable()
export class ReconciliationService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Reconcile bale counts for a parcel: produced vs loaded vs delivered.
   */
  async reconcileBalesForParcel(parcelId: string): Promise<BaleReconciliationResult> {
    // Count bales produced (from bale_productions table)
    const producedResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int AS total
          FROM bale_productions
          WHERE parcel_id = ${parcelId} AND deleted_at IS NULL`,
    );
    const producedRows = producedResult as unknown as { total: number }[];
    const produced = producedRows[0]?.total ?? 0;

    // Count bales loaded directly off bale_loads.parcel_id — the SAME source of
    // truth as computeRemainingBalesOnParcel() / registerLoad()'s availability
    // check. Joining through trips.source_parcel_id undercounts loads whose trip
    // has a NULL/different source_parcel_id, diverging from the operational gate.
    const loadedResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int AS total
          FROM bale_loads
          WHERE parcel_id = ${parcelId} AND deleted_at IS NULL`,
    );
    const loadedRows = loadedResult as unknown as { total: number }[];
    const loaded = loadedRows[0]?.total ?? 0;

    // Count bales delivered (from completed trips sourced from this parcel)
    const deliveredResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int AS total
          FROM trips
          WHERE source_parcel_id = ${parcelId}
            AND status IN ('delivered', 'completed')
            AND deleted_at IS NULL`,
    );
    const deliveredRows = deliveredResult as unknown as { total: number }[];
    const delivered = deliveredRows[0]?.total ?? 0;

    return reconcileBales({ parcelId, produced, loaded, delivered });
  }

  /**
   * Reconcile fuel usage for a machine: actual vs expected consumption.
   */
  async reconcileFuelForMachine(machineId: string): Promise<FuelReconciliationResult> {
    // Total distance from completed trips using this machine as truck.
    // Distance is the GPS-derived route length (gps_distance_km), populated at
    // arrive and recomputed by recomputeRecentTripDistances() below.
    const distanceResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(gps_distance_km), 0)::numeric AS total_km
          FROM trips
          WHERE truck_id = ${machineId}
            AND status IN ('delivered', 'completed')
            AND deleted_at IS NULL`,
    );
    const distanceRows = distanceResult as unknown as { total_km: number }[];
    const distanceKm = Number(distanceRows[0]?.total_km ?? 0);

    // Total fuel consumed from fuel_logs for this machine
    const fuelResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(quantity_liters), 0)::numeric AS total_liters
          FROM fuel_logs
          WHERE machine_id = ${machineId} AND deleted_at IS NULL`,
    );
    const fuelRows = fuelResult as unknown as { total_liters: number }[];
    const fuelUsedLiters = Number(fuelRows[0]?.total_liters ?? 0);

    // Expected consumption: there is no per-machine consumption column in the
    // schema (machines never had `fuel_consumption_l_per_km` — selecting it threw
    // and aborted the whole reconciliation), so use the truck default directly.
    const expectedConsumptionLPerKm = 0.35;

    return reconcileFuel({
      machineId,
      distanceKm,
      fuelUsedLiters,
      expectedConsumptionLPerKm,
      tolerancePercent: 20,
    });
  }

  /**
   * Recompute gps_distance_km for trips that arrived recently, so the route
   * length picks up GPS pings that synced late from the driver's phone after
   * the arrive transition. Mirrors the pairwise ST_DistanceSphere computation
   * done inline in TripsService.arrive().
   *
   * Returns the number of trips updated.
   */
  async recomputeRecentTripDistances(): Promise<number> {
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips AS t SET
        gps_distance_km = (
          SELECT ROUND((COALESCE(SUM(
            -- Same GPS noise filter as TripsService.arrive() / reports.service.ts:
            -- drop legs > 5 km or implying > 130 km/h (36 m/s).
            CASE
              WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
              WHEN leg_m > 5000 THEN 0
              WHEN (leg_m / dt_s) > 36 THEN 0
              ELSE leg_m
            END
          ), 0) / 1000.0)::numeric, 2)
          FROM (
            SELECT
              ST_DistanceSphere(LAG(geom) OVER w, geom) AS leg_m,
              EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
            FROM (
              SELECT recorded_at,
                     ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
              FROM machine_location_events
              WHERE machine_id = t.truck_id
                AND recorded_at >= t.departure_at
                AND recorded_at <= COALESCE(t.arrival_at, NOW())
            ) pts
            WINDOW w AS (ORDER BY recorded_at)
          ) pairwise
        ),
        updated_at = NOW()
      WHERE t.arrival_at >= NOW() - INTERVAL '2 hours'
        AND t.departure_at IS NOT NULL
        AND t.truck_id IS NOT NULL
        AND t.deleted_at IS NULL`,
    );
    return (result as unknown as unknown[]).length;
  }
}
