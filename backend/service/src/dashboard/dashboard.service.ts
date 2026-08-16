import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { dateWindowClause, tsWindowClause } from '../common/season-range';
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
    return dateWindowClause(sql`bp.production_date`, range);
  }

  /**
   * Filter logged_at on fuel_logs / consumable_logs.
   *
   * This used to append a literal `T00:00:00.000Z` / `T23:59:59.999Z` to the
   * bare day, i.e. anchor a Romanian operational day to UTC — so a refuel at
   * 01:00 on the 1st was billed to the previous month and one at 23:30 on the
   * last day vanished from both. The shared helper converts through
   * Europe/Bucharest and follows DST.
   */
  private loggedAtFilter(range: DashboardDateRange | undefined, alias: 'fl' | 'cl') {
    return tsWindowClause(sql`${sql.raw(alias)}.logged_at`, range);
  }

  /**
   * The unfiltered (cross-org) branch is gated on an explicit super_admin
   * role, never on `orgId` being null — an unauthenticated/anon identity
   * also produces a null orgId and must never see every org's analytics.
   */
  private orgFilter(orgId: string | null, callerRole: string) {
    return callerRole === 'super_admin' ? sql`` : sql` AND organization_id = ${orgId}::uuid`;
  }

  /**
   * @param range the season window. Only the two genuinely cumulative counters
   *   take it: `pending_alerts` (an unacknowledged flag from a closed season
   *   would ring the bell forever) and `active_trips`. The four "today"
   *   counters are already bounded to today by definition and are left alone —
   *   windowing them would make the card read zero whenever an admin is looking
   *   at a past season, which is worse than leaving them as live operations.
   */
  async getOverview(
    orgId: string | null,
    callerRole: string,
    range?: DashboardDateRange,
  ): Promise<DashboardOverview> {
    const orgFilter = this.orgFilter(orgId, callerRole);
    const alertsWin = tsWindowClause(sql`created_at`, range);

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM trips
         WHERE status IN ('loading', 'loaded', 'in_transit', 'arrived', 'delivering')
           AND deleted_at IS NULL ${orgFilter}
        ) AS active_trips,
        (SELECT COALESCE(SUM(bale_count), 0)::int FROM bale_productions
         WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL ${orgFilter}
        ) AS bales_today,
        (SELECT COUNT(*)::int FROM machines
         WHERE is_active = true AND deleted_at IS NULL ${orgFilter}
        ) AS active_machines,
        (SELECT COUNT(*)::int FROM alerts
         WHERE is_acknowledged = false ${orgFilter}${alertsWin}
        ) AS pending_alerts,
        (SELECT COUNT(*)::int FROM trips
         WHERE created_at >= CURRENT_DATE AND deleted_at IS NULL ${orgFilter}
        ) AS trips_today,
        (SELECT COUNT(*)::int FROM trips
         WHERE status = 'completed'
           AND completed_at >= CURRENT_DATE
           AND deleted_at IS NULL ${orgFilter}
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

  async getProduction(
    orgId: string | null,
    callerRole: string,
    range?: DashboardDateRange,
  ): Promise<ProductionReport[]> {
    const prodExtra = this.productionDateFilter(range);
    // The range used to be applied to `produced` ONLY, while `loaded` and
    // `delivered` stayed all-time. Every loss percentage this report has ever
    // shown for a bounded range was therefore computed from a windowed
    // numerator over a lifetime denominator — routinely a negative loss, i.e.
    // more bales loaded than grown. All three terms are windowed now.
    const loadedExtra = tsWindowClause(sql`bl.loaded_at`, range);
    const deliveredExtra = tsWindowClause(
      sql`COALESCE(t2.delivered_at, t2.completed_at, t2.created_at)`,
      range,
    );
    const orgFilter = this.orgFilter(orgId, callerRole);

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
            ${loadedExtra}
        ), 0) AS loaded,
        COALESCE((
          SELECT SUM(t2.bale_count)::int
          FROM trips t2
          WHERE t2.source_parcel_id = p.id
            AND t2.status IN ('delivered', 'completed')
            AND t2.deleted_at IS NULL
            ${deliveredExtra}
        ), 0) AS delivered
      FROM parcels p
      WHERE p.deleted_at IS NULL ${orgFilter}
      ORDER BY p.name
    `);

    const rows = result as unknown as Record<string, unknown>[];
    return rows.map((row) => {
      const produced = (row.produced as number) ?? 0;
      const delivered = (row.delivered as number) ?? 0;
      const lossPercentage = produced > 0 ? ((produced - delivered) / produced) * 100 : 0;

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

  async getCosts(
    orgId: string | null,
    callerRole: string,
    range?: DashboardDateRange,
  ): Promise<CostReport[]> {
    const fuelMachineDates = this.loggedAtFilter(range, 'fl');
    const consMachineDates = this.loggedAtFilter(range, 'cl');
    const fuelParcelDates = this.loggedAtFilter(range, 'fl');
    const consParcelDates = this.loggedAtFilter(range, 'cl');
    const orgFilter = this.orgFilter(orgId, callerRole);

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
      WHERE m.deleted_at IS NULL ${orgFilter}
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
      WHERE p.deleted_at IS NULL ${orgFilter}
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

  async getTrending(orgId: string | null, callerRole: string) {
    const orgFilter = this.orgFilter(orgId, callerRole);

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
            AND t.deleted_at IS NULL ${orgFilter}
        ), 0) AS "tripsCompleted"
      FROM dates
      LEFT JOIN bale_productions bp
        ON bp.production_date = dates.d AND bp.deleted_at IS NULL ${orgFilter}
      GROUP BY dates.d
      ORDER BY dates.d ASC
    `);
    return result;
  }

  async getAntiFraud(
    orgId: string | null,
    callerRole: string,
    range?: DashboardDateRange,
  ): Promise<AntiFraudReport> {
    const orgFilter = this.orgFilter(orgId, callerRole);
    // `alerts` is the one transactional table with no `deleted_at`, and these
    // counts were unbounded, so a fraud flag raised in 2026 stayed on the 2027
    // dashboard forever. Windowed on when the alert was raised.
    const win = tsWindowClause(sql`created_at`, range);

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM alerts
         WHERE category = 'fraud' ${orgFilter}${win}
        ) AS flagged_trips,
        (SELECT COUNT(*)::int FROM alerts
         WHERE title LIKE '%Fuel%' ${orgFilter}${win}
        ) AS fuel_anomalies,
        (SELECT COUNT(*)::int FROM alerts
         WHERE title LIKE '%timing%' ${orgFilter}${win}
        ) AS timing_anomalies
    `);

    const rows = result as unknown as Record<string, unknown>[];
    const row = rows[0] ?? {};

    // Fetch recent alerts
    const alertsResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM alerts
          WHERE category IN ('fraud', 'anomaly') ${orgFilter}${win}
          ORDER BY created_at DESC
          LIMIT 20`,
    );
    const recentAlerts = alertsResult as unknown as Record<string, unknown>[];

    return {
      flaggedTrips: (row.flagged_trips as number) ?? 0,
      fuelAnomalies: (row.fuel_anomalies as number) ?? 0,
      timingAnomalies: (row.timing_anomalies as number) ?? 0,
      recentAlerts: recentAlerts as unknown as AntiFraudReport['recentAlerts'],
    };
  }
}
