import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { reconcileBales, reconcileFuel } from '@strawboss/domain';
import type {
  BaleReconciliationResult,
  FuelReconciliationResult,
} from '@strawboss/domain';

@Injectable()
export class ReconciliationService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  /**
   * Reconcile bale counts for a parcel: produced vs loaded vs delivered.
   */
  async reconcileBalesForParcel(
    parcelId: string,
  ): Promise<BaleReconciliationResult> {
    // Count bales produced (from bale_productions table)
    const producedResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int AS total
          FROM bale_productions
          WHERE parcel_id = ${parcelId} AND deleted_at IS NULL`,
    );
    const producedRows = producedResult as unknown as { total: number }[];
    const produced = producedRows[0]?.total ?? 0;

    // Count bales loaded (from bale_loads for trips sourced from this parcel)
    const loadedResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bl.bale_count), 0)::int AS total
          FROM bale_loads bl
          JOIN trips t ON t.id = bl.trip_id
          WHERE t.source_parcel_id = ${parcelId}
            AND bl.deleted_at IS NULL
            AND t.deleted_at IS NULL`,
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
  async reconcileFuelForMachine(
    machineId: string,
  ): Promise<FuelReconciliationResult> {
    // Total distance from completed trips using this machine as truck
    const distanceResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(odometer_distance_km), 0)::numeric AS total_km
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

    // Get expected consumption from machine record
    const machineResult = await this.drizzleProvider.db.execute(
      sql`SELECT fuel_consumption_l_per_km FROM machines
          WHERE id = ${machineId} AND deleted_at IS NULL LIMIT 1`,
    );
    const machineRows = machineResult as unknown as {
      fuel_consumption_l_per_km: number | null;
    }[];
    // Default expected consumption: 0.35 L/km for a truck
    const expectedConsumptionLPerKm =
      Number(machineRows[0]?.fuel_consumption_l_per_km) || 0.35;

    return reconcileFuel({
      machineId,
      distanceKm,
      fuelUsedLiters,
      expectedConsumptionLPerKm,
      tolerancePercent: 20,
    });
  }
}
