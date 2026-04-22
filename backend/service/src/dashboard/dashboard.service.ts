import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type {
  DashboardOverview,
  ProductionReport,
  CostReport,
  AntiFraudReport,
} from '@strawboss/types';

interface DashboardDateRange {
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class DashboardService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  private productionDateFilter(range?: DashboardDateRange) {
    const parts: ReturnType<typeof sql>[] = [];
    if (range?.dateFrom) {
      parts.push(sql`bp.production_date >= ${range.dateFrom}::date`);
    }
    if (range?.dateTo) {
      parts.push(sql`bp.production_date <= ${range.dateTo}::date`);
    }
    if (parts.length === 0) return sql``;
    return sql` AND ${sql.join(parts, sql` AND `)}`;
  }

  /** Filter logged_at on fuel_logs / consumable_logs (mobile sends full-day Z on list APIs). */
  private loggedAtFilter(
    range: DashboardDateRange | undefined,
    alias: 'fl' | 'cl',
  ) {
    const parts: ReturnType<typeof sql>[] = [];
    if (range?.dateFrom) {
      parts.push(
        sql`${sql.raw(alias)}.logged_at >= ${`${range.dateFrom}T00:00:00.000Z`}::timestamptz`,
      );
    }
    if (range?.dateTo) {
      parts.push(
        sql`${sql.raw(alias)}.logged_at <= ${`${range.dateTo}T23:59:59.999Z`}::timestamptz`,
      );
    }
    if (parts.length === 0) return sql``;
    return sql` AND ${sql.join(parts, sql` AND `)}`;
  }

  async getOverview(): Promise<DashboardOverview> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM trips
         WHERE status IN ('loading', 'loaded', 'in_transit', 'arrived', 'delivering')
           AND deleted_at IS NULL
        ) AS active_trips,
        (SELECT COALESCE(SUM(bale_count), 0)::int FROM bale_productions
         WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL
        ) AS bales_today,
        (SELECT COUNT(*)::int FROM machines
         WHERE is_active = true AND deleted_at IS NULL
        ) AS active_machines,
        (SELECT COUNT(*)::int FROM alerts
         WHERE is_acknowledged = false
        ) AS pending_alerts,
        (SELECT COUNT(*)::int FROM trips
         WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL
        ) AS trips_today,
        (SELECT COUNT(*)::int FROM trips
         WHERE status = 'completed'
           AND completed_at >= CURRENT_DATE
           AND deleted_at IS NULL
        ) AS trips_completed
    `);

    const rows = result as unknown as Record<string, unknown>[];
    const row = rows[0] ?? {};

    return {
      activeTrips: (row.active_trips as number) ?? 0,
      balesToday: (row.bales_today as number) ?? 0,
      activeMachines: (row.active_machines as number) ?? 0,
      pendingAlerts: (row.pending_alerts as number) ?? 0,
      tripsToday: (row.trips_today as number) ?? 0,
      tripsCompleted: (row.trips_completed as number) ?? 0,
    };
  }

  async getProduction(range?: DashboardDateRange): Promise<ProductionReport[]> {
    const prodExtra = this.productionDateFilter(range);
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        p.id AS parcel_id,
        p.name AS parcel_name,
        COALESCE((
          SELECT SUM(bp.bale_count)::int
          FROM bale_productions bp
          WHERE bp.parcel_id = p.id AND bp.deleted_at IS NULL
            ${prodExtra}
        ), 0) AS produced,
        COALESCE((
          SELECT SUM(bl.bale_count)::int
          FROM bale_loads bl
          JOIN trips t ON t.id = bl.trip_id
          WHERE t.source_parcel_id = p.id
            AND bl.deleted_at IS NULL AND t.deleted_at IS NULL
        ), 0) AS loaded,
        COALESCE((
          SELECT SUM(t2.bale_count)::int
          FROM trips t2
          WHERE t2.source_parcel_id = p.id
            AND t2.status IN ('delivered', 'completed')
            AND t2.deleted_at IS NULL
        ), 0) AS delivered
      FROM parcels p
      WHERE p.deleted_at IS NULL
      ORDER BY p.name
    `);

    const rows = result as unknown as Record<string, unknown>[];
    return rows.map((row) => {
      const produced = (row.produced as number) ?? 0;
      const delivered = (row.delivered as number) ?? 0;
      const lossPercentage =
        produced > 0 ? ((produced - delivered) / produced) * 100 : 0;

      return {
        parcelId: row.parcel_id as string,
        parcelName: row.parcel_name as string,
        produced,
        loaded: (row.loaded as number) ?? 0,
        delivered,
        lossPercentage,
      };
    });
  }

  async getCosts(range?: DashboardDateRange): Promise<CostReport[]> {
    const fuelMachineDates = this.loggedAtFilter(range, 'fl');
    const consMachineDates = this.loggedAtFilter(range, 'cl');
    const fuelParcelDates = this.loggedAtFilter(range, 'fl');
    const consParcelDates = this.loggedAtFilter(range, 'cl');

    // Costs by machine (machines has no 'name' column — build display name from available fields)
    const machineResult = await this.drizzleProvider.db.execute(sql`
      SELECT
        m.id AS entity_id,
        COALESCE(m.internal_code, m.registration_plate, m.make || ' ' || m.model, 'Machine') AS entity_name,
        'machine' AS entity_type,
        COALESCE((
          SELECT SUM(
            COALESCE(
              fl.total_cost,
              fl.quantity_liters * COALESCE(fl.unit_price, 0),
              0
            )
          )::numeric
          FROM fuel_logs fl
          WHERE fl.machine_id = m.id AND fl.deleted_at IS NULL
            ${fuelMachineDates}
        ), 0) AS fuel_cost,
        COALESCE((
          SELECT SUM(
            COALESCE(
              cl.total_cost,
              cl.quantity * COALESCE(cl.unit_price, 0),
              0
            )
          )::numeric
          FROM consumable_logs cl
          WHERE cl.machine_id = m.id AND cl.deleted_at IS NULL
            ${consMachineDates}
        ), 0) AS consumable_cost
      FROM machines m
      WHERE m.deleted_at IS NULL
      ORDER BY entity_name
    `);

    const machineRows = machineResult as unknown as Record<string, unknown>[];

    // Costs by parcel
    const parcelResult = await this.drizzleProvider.db.execute(sql`
      SELECT
        p.id AS entity_id,
        p.name AS entity_name,
        'parcel' AS entity_type,
        COALESCE((
          SELECT SUM(
            COALESCE(
              fl.total_cost,
              fl.quantity_liters * COALESCE(fl.unit_price, 0),
              0
            )
          )::numeric
          FROM fuel_logs fl
          JOIN trips t ON t.truck_id = fl.machine_id
          WHERE t.source_parcel_id = p.id
            AND fl.deleted_at IS NULL AND t.deleted_at IS NULL
            ${fuelParcelDates}
        ), 0) AS fuel_cost,
        COALESCE((
          SELECT SUM(
            COALESCE(
              cl.total_cost,
              cl.quantity * COALESCE(cl.unit_price, 0),
              0
            )
          )::numeric
          FROM consumable_logs cl
          JOIN trips t ON t.truck_id = cl.machine_id
          WHERE t.source_parcel_id = p.id
            AND cl.deleted_at IS NULL AND t.deleted_at IS NULL
            ${consParcelDates}
        ), 0) AS consumable_cost
      FROM parcels p
      WHERE p.deleted_at IS NULL
      ORDER BY p.name
    `);

    const parcelRows = parcelResult as unknown as Record<string, unknown>[];

    const allRows = [...machineRows, ...parcelRows];
    return allRows.map((row) => {
      const fuelCost = Number(row.fuel_cost) || 0;
      const consumableCost = Number(row.consumable_cost) || 0;
      return {
        entityId: row.entity_id as string,
        entityName: row.entity_name as string,
        entityType: row.entity_type as 'parcel' | 'machine',
        fuelCost,
        consumableCost,
        totalCost: fuelCost + consumableCost,
      };
    });
  }

  async getTrending() {
    const result = await this.drizzleProvider.db.execute(sql`
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'
        )::date AS d
      )
      SELECT
        dates.d AS "date",
        COALESCE(SUM(bp.bale_count), 0)::int AS "bales",
        COALESCE((
          SELECT COUNT(*)::int FROM trips t
          WHERE t.completed_at::date = dates.d
            AND t.status IN ('delivered', 'completed')
            AND t.deleted_at IS NULL
        ), 0) AS "tripsCompleted"
      FROM dates
      LEFT JOIN bale_productions bp
        ON bp.production_date = dates.d AND bp.deleted_at IS NULL
      GROUP BY dates.d
      ORDER BY dates.d ASC
    `);
    return result;
  }

  async getAntiFraud(): Promise<AntiFraudReport> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM alerts
         WHERE category = 'fraud'
        ) AS flagged_trips,
        (SELECT COUNT(*)::int FROM alerts
         WHERE title LIKE '%Odometer%'
        ) AS odometer_anomalies,
        (SELECT COUNT(*)::int FROM alerts
         WHERE title LIKE '%Fuel%'
        ) AS fuel_anomalies,
        (SELECT COUNT(*)::int FROM alerts
         WHERE title LIKE '%timing%'
        ) AS timing_anomalies
    `);

    const rows = result as unknown as Record<string, unknown>[];
    const row = rows[0] ?? {};

    // Fetch recent alerts
    const alertsResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM alerts
          WHERE category IN ('fraud', 'anomaly')
          ORDER BY created_at DESC
          LIMIT 20`,
    );
    const recentAlerts = alertsResult as unknown as Record<string, unknown>[];

    return {
      flaggedTrips: (row.flagged_trips as number) ?? 0,
      odometerAnomalies: (row.odometer_anomalies as number) ?? 0,
      fuelAnomalies: (row.fuel_anomalies as number) ?? 0,
      timingAnomalies: (row.timing_anomalies as number) ?? 0,
      recentAlerts: recentAlerts as unknown as AntiFraudReport['recentAlerts'],
    };
  }
}
