import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type {
  FarmReport,
  FieldReport,
  DepotReport,
  ReportTimelinePoint,
  TruckDistanceRow,
  TruckDistanceSummary,
  OperatorDistanceRow,
  ConnectedHoursGroupBy,
  ConnectedHoursReport,
  ConnectedHoursRow,
} from '@strawboss/types';

/** T18 — drop GPS legs that imply > 130 km/h (noise) or > 5 km in one segment. */
import { SPEED_CAP_MS, SEGMENT_CAP_M } from '../common/gps-noise';

interface ReportDateRange {
  dateFrom?: string;
  dateTo?: string;
}

/** Synthetic farm name for parcels not assigned to any farm. */
const FARMLESS_NAME = 'Fără fermă';

/**
 * Coerce a DB value to a finite number; null/undefined/NaN/Infinity all → 0.
 * Replaces the older `Number(x) || 0` pattern which masked legitimate `0`
 * values and silently absorbed NaN coming from unexpected DB types.
 */
function numberOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class ReportsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  private orgFilter(orgId: string | null, col: ReturnType<typeof sql>) {
    return orgId !== null ? sql` AND ${col} = ${orgId}::uuid` : sql``;
  }

  /** Date-range filter on a `DATE` column (bale_productions.production_date). */
  private productionDateFilter(range?: ReportDateRange) {
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

  /** Date-range filter on a `TIMESTAMPTZ` column/expression. */
  private timestampRangeFilter(
    range: ReportDateRange | undefined,
    colExpr: ReturnType<typeof sql>,
  ) {
    const parts: ReturnType<typeof sql>[] = [];
    if (range?.dateFrom) {
      parts.push(sql`${colExpr} >= ${range.dateFrom}::date`);
    }
    if (range?.dateTo) {
      parts.push(sql`${colExpr} < (${range.dateTo}::date + 1)`);
    }
    if (parts.length === 0) return sql``;
    return sql` AND ${sql.join(parts, sql` AND `)}`;
  }

  /**
   * Production per farm, with a per-field (parcel) breakdown.
   * Parcels with no farm fall into a synthetic "Fără fermă" bucket.
   */
  async getFarmReports(orgId: string | null, range?: ReportDateRange): Promise<FarmReport[]> {
    const prodFilter = this.productionDateFilter(range);
    const loadedFilter = this.timestampRangeFilter(range, sql`bl.loaded_at`);
    const deliveredFilter = this.timestampRangeFilter(
      range,
      sql`COALESCE(t2.delivered_at, t2.completed_at)`,
    );
    const parcelOrg = this.orgFilter(orgId, sql`p.organization_id`);
    const deliveredOrg = this.orgFilter(orgId, sql`t2.organization_id`);

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        p.id AS parcel_id,
        p.name AS parcel_name,
        p.code AS parcel_code,
        p.farm_id AS farm_id,
        f.name AS farm_name,
        COALESCE((
          SELECT SUM(bp.bale_count)::int
          FROM bale_productions bp
          WHERE bp.parcel_id = p.id AND bp.deleted_at IS NULL
            ${prodFilter}
        ), 0) AS produced,
        COALESCE((
          SELECT SUM(bl.bale_count)::int
          FROM bale_loads bl
          JOIN trips t ON t.id = bl.trip_id
          WHERE t.source_parcel_id = p.id
            AND bl.deleted_at IS NULL AND t.deleted_at IS NULL
            ${loadedFilter}
        ), 0) AS loaded,
        COALESCE((
          SELECT SUM(t2.bale_count)::int
          FROM trips t2
          WHERE t2.source_parcel_id = p.id
            AND t2.status IN ('delivered', 'completed')
            AND t2.deleted_at IS NULL ${deliveredOrg}
            ${deliveredFilter}
        ), 0) AS delivered
      FROM parcels p
      LEFT JOIN farms f ON f.id = p.farm_id AND f.deleted_at IS NULL
      WHERE p.deleted_at IS NULL ${parcelOrg}
      ORDER BY p.name
    `);

    const rows = result as unknown as Record<string, unknown>[];
    const farmsMap = new Map<string, FarmReport>();

    for (const row of rows) {
      const farmId = (row.farm_id as string | null) ?? null;
      const key = farmId ?? '__farmless__';
      const produced = numberOrZero(row.produced);
      const loaded = numberOrZero(row.loaded);
      const delivered = numberOrZero(row.delivered);

      const field: FieldReport = {
        parcelId: row.parcel_id as string,
        parcelName: row.parcel_name as string,
        parcelCode: (row.parcel_code as string) ?? '',
        produced,
        loaded,
        delivered,
        lossPercentage: produced > 0 ? Math.max(0, ((produced - delivered) / produced) * 100) : 0,
      };

      let farm = farmsMap.get(key);
      if (!farm) {
        farm = {
          farmId,
          farmName: (row.farm_name as string | null) ?? FARMLESS_NAME,
          fieldCount: 0,
          produced: 0,
          loaded: 0,
          delivered: 0,
          lossPercentage: 0,
          fields: [],
        };
        farmsMap.set(key, farm);
      }

      farm.fields.push(field);
      farm.fieldCount += 1;
      farm.produced += produced;
      farm.loaded += loaded;
      farm.delivered += delivered;
    }

    const farms = [...farmsMap.values()];
    for (const farm of farms) {
      farm.lossPercentage =
        farm.produced > 0
          ? Math.max(0, ((farm.produced - farm.delivered) / farm.produced) * 100)
          : 0;
    }

    // Named farms alphabetically; the synthetic "no farm" bucket last.
    farms.sort((a, b) => {
      if (a.farmId === null) return 1;
      if (b.farmId === null) return -1;
      return a.farmName.localeCompare(b.farmName);
    });

    return farms;
  }

  /**
   * Stock per depot (delivery destination).
   * NOTE: trips have no FK to delivery_destinations — they store a free-text
   * `destination_name`. Stock is therefore matched by `trips.destination_name = d.name`.
   */
  async getDepotReports(orgId: string | null, range?: ReportDateRange): Promise<DepotReport[]> {
    const tripOrg = this.orgFilter(orgId, sql`t.organization_id`);
    const depotOrg = this.orgFilter(orgId, sql`d.organization_id`);
    const receivedFilter = this.timestampRangeFilter(
      range,
      sql`COALESCE(t.delivered_at, t.completed_at)`,
    );

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        d.id AS depot_id,
        d.name AS depot_name,
        d.code AS depot_code,
        -- Stock = INBOUND - OUTBOUND. The outbound term (bales loaded straight out
        -- of this depot, bale_loads.source_depot_id, added in 00073) was missing
        -- entirely, so "stock" was an all-time accumulator that never went down.
        -- received_in_period and arriving_now below are FLOW figures, not a
        -- balance, so they are deliberately left inbound-only.
        GREATEST(
          COALESCE((
            SELECT SUM(t.bale_count)::int
            FROM trips t
            WHERE t.destination_name = d.name
              AND t.status IN ('delivered', 'completed')
              AND t.deleted_at IS NULL ${tripOrg}
          ), 0)
          -
          COALESCE((
            SELECT SUM(bl.bale_count)::int
            FROM bale_loads bl
            WHERE bl.source_depot_id = d.id
              AND bl.deleted_at IS NULL ${this.orgFilter(orgId, sql`bl.organization_id`)}
          ), 0),
          0
        ) AS total_stock,
        COALESCE((
          SELECT SUM(t.bale_count)::int
          FROM trips t
          WHERE t.destination_name = d.name
            AND t.status IN ('delivered', 'completed')
            AND t.deleted_at IS NULL ${tripOrg}
            ${receivedFilter}
        ), 0) AS received_in_period,
        COALESCE((
          SELECT SUM(t.bale_count)::int
          FROM trips t
          WHERE t.destination_name = d.name
            AND t.status IN ('arrived', 'delivering')
            AND t.deleted_at IS NULL ${tripOrg}
        ), 0) AS arriving_now,
        COALESCE((
          SELECT COUNT(*)::int
          FROM trips t
          WHERE t.destination_name = d.name
            AND t.status IN ('delivered', 'completed')
            AND t.deleted_at IS NULL ${tripOrg}
        ), 0) AS delivery_count
      FROM delivery_destinations d
      WHERE d.deleted_at IS NULL ${depotOrg}
      ORDER BY d.name
    `);

    const rows = result as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      depotId: row.depot_id as string,
      depotName: row.depot_name as string,
      depotCode: (row.depot_code as string) ?? '',
      totalStock: numberOrZero(row.total_stock),
      receivedInPeriod: numberOrZero(row.received_in_period),
      arrivingNow: numberOrZero(row.arriving_now),
      deliveryCount: numberOrZero(row.delivery_count),
    }));
  }

  /**
   * Daily produced / loaded / delivered series across the date range,
   * with gaps filled via generate_series. Optionally scoped to one farm.
   */
  async getTimeline(
    orgId: string | null,
    range?: ReportDateRange,
    farmId?: string,
  ): Promise<ReportTimelinePoint[]> {
    const MAX_RANGE_DAYS = 366;
    if (range?.dateFrom && range?.dateTo) {
      const spanDays = (Date.parse(range.dateTo) - Date.parse(range.dateFrom)) / 86_400_000;
      if (spanDays < 0) {
        throw new BadRequestException('"dateFrom" must be ≤ "dateTo"');
      }
      if (spanDays > MAX_RANGE_DAYS) {
        throw new BadRequestException(`Date range exceeds ${MAX_RANGE_DAYS} days`);
      }
    }

    // Upper bound: explicit dateTo, else the database's CURRENT_DATE — avoids
    // a UTC-vs-local off-by-one that drops the current day for users ahead of UTC.
    const toExpr = range?.dateTo ? sql`${range.dateTo}::date` : sql`CURRENT_DATE`;
    const fromExpr = range?.dateFrom ? sql`${range.dateFrom}::date` : sql`(${toExpr} - 29)`;

    const bpOrg = this.orgFilter(orgId, sql`bp.organization_id`);
    const tripOrg = this.orgFilter(orgId, sql`t.organization_id`);
    const farmFilter = farmId ? sql` AND p.farm_id = ${farmId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(sql`
      WITH dates AS (
        SELECT generate_series(${fromExpr}, ${toExpr}, '1 day')::date AS d
      )
      SELECT
        to_char(dates.d, 'YYYY-MM-DD') AS "date",
        COALESCE((
          SELECT SUM(bp.bale_count)::int
          FROM bale_productions bp
          JOIN parcels p ON p.id = bp.parcel_id AND p.deleted_at IS NULL
          WHERE bp.production_date = dates.d AND bp.deleted_at IS NULL
            ${bpOrg} ${farmFilter}
        ), 0) AS produced,
        COALESCE((
          SELECT SUM(bl.bale_count)::int
          FROM bale_loads bl
          JOIN trips t ON t.id = bl.trip_id AND t.deleted_at IS NULL
          JOIN parcels p ON p.id = t.source_parcel_id AND p.deleted_at IS NULL
          WHERE bl.loaded_at::date = dates.d AND bl.deleted_at IS NULL
            ${tripOrg} ${farmFilter}
        ), 0) AS loaded,
        COALESCE((
          SELECT SUM(t.bale_count)::int
          FROM trips t
          JOIN parcels p ON p.id = t.source_parcel_id AND p.deleted_at IS NULL
          WHERE COALESCE(t.delivered_at, t.completed_at)::date = dates.d
            AND t.status IN ('delivered', 'completed')
            AND t.deleted_at IS NULL
            ${tripOrg} ${farmFilter}
        ), 0) AS delivered
      FROM dates
      ORDER BY dates.d ASC
    `);

    const rows = result as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      date: row.date as string,
      produced: numberOrZero(row.produced),
      loaded: numberOrZero(row.loaded),
      delivered: numberOrZero(row.delivered),
    }));
  }

  /**
   * T18 — bulk per-truck-per-day distance, derived from machine_location_events.
   *
   * Sums pairwise `ST_DistanceSphere` legs between consecutive GPS samples
   * per (machine, UTC day). GPS noise is suppressed by dropping any leg that
   * (a) covers > 5 km in a single segment, or (b) implies a speed > 130 km/h
   * for the inter-sample dt. Scoped by `machines.organization_id` since
   * `machine_location_events` has no org column. Range capped at 90 days.
   */
  async getTruckDistance(
    orgId: string | null,
    params: { from: string; to: string; machineId?: string },
  ): Promise<TruckDistanceRow[]> {
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    if (Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" parameter');
    }
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" parameter');
    }
    if (fromDate > toDate) {
      throw new BadRequestException('"from" must be ≤ "to"');
    }
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (diffDays > 90) {
      throw new BadRequestException('Range cannot exceed 90 days');
    }

    const orgFilter = orgId !== null ? sql`AND m.organization_id = ${orgId}::uuid` : sql``;
    const machineFilter = params.machineId ? sql`AND m.id = ${params.machineId}::uuid` : sql``;

    const result = (await this.drizzleProvider.db.execute(sql`
      WITH pts AS (
        SELECT
          mle.machine_id,
          mle.operator_id,
          (mle.recorded_at AT TIME ZONE 'UTC')::date AS day,
          mle.recorded_at,
          ST_SetSRID(ST_MakePoint(mle.lon, mle.lat), 4326) AS geom
        FROM machine_location_events mle
        JOIN machines m ON m.id = mle.machine_id
        WHERE m.deleted_at IS NULL
          AND m.machine_type = 'truck'
          ${orgFilter}
          ${machineFilter}
          AND mle.recorded_at >= ${params.from}::date
          AND mle.recorded_at <  (${params.to}::date + INTERVAL '1 day')
      ),
      pairwise AS (
        SELECT
          machine_id, day,
          ST_DistanceSphere(LAG(geom) OVER w, geom) AS leg_m,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
        FROM pts
        WINDOW w AS (PARTITION BY machine_id, day ORDER BY recorded_at)
      ),
      clean AS (
        SELECT machine_id, day,
          CASE
            WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
            WHEN leg_m > ${SEGMENT_CAP_M} THEN 0
            WHEN (leg_m / dt_s) > ${SPEED_CAP_MS} THEN 0
            ELSE leg_m
          END AS leg_m
        FROM pairwise
      )
      SELECT
        c.machine_id AS "machineId",
        COALESCE(m.internal_code, m.registration_plate) AS "machineCode",
        m.registration_plate AS "registrationPlate",
        c.day::text AS "date",
        ROUND((SUM(c.leg_m) / 1000.0)::numeric, 2)::float AS "distanceKm",
        COUNT(*)::int AS "pointCount",
        (
          SELECT u.full_name
          FROM pts p2
          LEFT JOIN users u ON u.id = p2.operator_id
          WHERE p2.machine_id = c.machine_id
            AND p2.day = c.day
            AND p2.operator_id IS NOT NULL
          GROUP BY u.full_name
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS "operatorName"
      FROM clean c
      JOIN machines m ON m.id = c.machine_id
      GROUP BY c.machine_id, m.internal_code, m.registration_plate, c.day
      ORDER BY c.day, "machineCode"
    `)) as unknown as TruckDistanceRow[];

    return result.map((r) => ({
      machineId: r.machineId,
      machineCode: r.machineCode ?? null,
      registrationPlate: r.registrationPlate ?? null,
      date: r.date,
      distanceKm: numberOrZero(r.distanceKm),
      pointCount: numberOrZero(r.pointCount),
      operatorName: r.operatorName ?? null,
    }));
  }

  /**
   * Per-operator-per-day distance, derived from machine_location_events the same
   * way as getTruckDistance but attributed to the driver (operator_id) instead
   * of the truck. Trucks only; same noise suppression; range capped at 90 days.
   */
  async getOperatorDistance(
    orgId: string | null,
    params: { from: string; to: string; operatorId?: string },
  ): Promise<OperatorDistanceRow[]> {
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    if (Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" parameter');
    }
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" parameter');
    }
    if (fromDate > toDate) {
      throw new BadRequestException('"from" must be ≤ "to"');
    }
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (diffDays > 90) {
      throw new BadRequestException('Range cannot exceed 90 days');
    }

    const orgFilter = orgId !== null ? sql`AND m.organization_id = ${orgId}::uuid` : sql``;
    const operatorFilter = params.operatorId
      ? sql`AND mle.operator_id = ${params.operatorId}::uuid`
      : sql``;

    const result = (await this.drizzleProvider.db.execute(sql`
      WITH pts AS (
        SELECT
          mle.operator_id,
          (mle.recorded_at AT TIME ZONE 'UTC')::date AS day,
          mle.recorded_at,
          ST_SetSRID(ST_MakePoint(mle.lon, mle.lat), 4326) AS geom
        FROM machine_location_events mle
        JOIN machines m ON m.id = mle.machine_id
        WHERE m.deleted_at IS NULL
          AND m.machine_type = 'truck'
          AND mle.operator_id IS NOT NULL
          ${orgFilter}
          ${operatorFilter}
          AND mle.recorded_at >= ${params.from}::date
          AND mle.recorded_at <  (${params.to}::date + INTERVAL '1 day')
      ),
      pairwise AS (
        SELECT
          operator_id, day,
          ST_DistanceSphere(LAG(geom) OVER w, geom) AS leg_m,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
        FROM pts
        WINDOW w AS (PARTITION BY operator_id, day ORDER BY recorded_at)
      ),
      clean AS (
        SELECT operator_id, day,
          CASE
            WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
            WHEN leg_m > ${SEGMENT_CAP_M} THEN 0
            WHEN (leg_m / dt_s) > ${SPEED_CAP_MS} THEN 0
            ELSE leg_m
          END AS leg_m
        FROM pairwise
      )
      SELECT
        c.operator_id AS "operatorId",
        u.full_name AS "operatorName",
        c.day::text AS "date",
        ROUND((SUM(c.leg_m) / 1000.0)::numeric, 2)::float AS "distanceKm",
        COUNT(*)::int AS "pointCount"
      FROM clean c
      LEFT JOIN users u ON u.id = c.operator_id
      GROUP BY c.operator_id, u.full_name, c.day
      ORDER BY c.day, "operatorName"
    `)) as unknown as OperatorDistanceRow[];

    return result.map((r) => ({
      operatorId: r.operatorId,
      operatorName: r.operatorName ?? null,
      date: r.date,
      distanceKm: numberOrZero(r.distanceKm),
      pointCount: numberOrZero(r.pointCount),
    }));
  }

  /**
   * T18 — "today / this week" km summary per truck. One row per truck in the
   * org with both totals (week starts Monday in UTC). Used by the Machines
   * admin page for at-a-glance columns.
   */
  async getTruckDistanceSummary(orgId: string | null): Promise<TruckDistanceSummary[]> {
    const orgFilter = orgId !== null ? sql`AND m.organization_id = ${orgId}::uuid` : sql``;

    const result = (await this.drizzleProvider.db.execute(sql`
      WITH bounds AS (
        SELECT
          date_trunc('week', CURRENT_DATE)::date AS week_start,
          CURRENT_DATE AS today
      ),
      pts AS (
        SELECT
          mle.machine_id,
          (mle.recorded_at AT TIME ZONE 'UTC')::date AS day,
          mle.recorded_at,
          ST_SetSRID(ST_MakePoint(mle.lon, mle.lat), 4326) AS geom
        FROM machine_location_events mle
        JOIN machines m ON m.id = mle.machine_id, bounds b
        WHERE m.deleted_at IS NULL
          AND m.machine_type = 'truck'
          ${orgFilter}
          AND mle.recorded_at >= b.week_start
          AND mle.recorded_at <  (b.today + INTERVAL '1 day')
      ),
      pairwise AS (
        SELECT
          machine_id, day,
          ST_DistanceSphere(LAG(geom) OVER w, geom) AS leg_m,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
        FROM pts
        WINDOW w AS (PARTITION BY machine_id, day ORDER BY recorded_at)
      ),
      clean AS (
        SELECT machine_id, day,
          CASE
            WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
            WHEN leg_m > ${SEGMENT_CAP_M} THEN 0
            WHEN (leg_m / dt_s) > ${SPEED_CAP_MS} THEN 0
            ELSE leg_m
          END AS leg_m
        FROM pairwise
      ),
      per_truck AS (
        SELECT
          machine_id,
          ROUND((SUM(CASE WHEN day = CURRENT_DATE THEN leg_m ELSE 0 END) / 1000.0)::numeric, 2)::float AS km_today,
          ROUND((SUM(leg_m) / 1000.0)::numeric, 2)::float AS km_this_week
        FROM clean
        GROUP BY machine_id
      )
      SELECT
        m.id AS "machineId",
        COALESCE(p.km_today, 0)::float AS "kmToday",
        COALESCE(p.km_this_week, 0)::float AS "kmThisWeek"
      FROM machines m
      LEFT JOIN per_truck p ON p.machine_id = m.id
      WHERE m.deleted_at IS NULL
        AND m.machine_type = 'truck'
        ${orgFilter}
    `)) as unknown as TruckDistanceSummary[];

    return result.map((r) => ({
      machineId: r.machineId,
      kmToday: numberOrZero(r.kmToday),
      kmThisWeek: numberOrZero(r.kmThisWeek),
    }));
  }

  /**
   * Plan A T4 — total connected hours per user per period.
   *
   * Splits each `user_sessions` row across the buckets it overlaps using
   * `GREATEST(started_at, period_start)` / `LEAST(ended_at, period_end)`, so a
   * session crossing midnight contributes the correct amount to each day.
   *
   * `groupBy` is one of 'day' | 'week' | 'month' (validated at the controller).
   * Range is capped at 366 days to keep the periods CTE bounded.
   */
  async getConnectedHours(
    orgId: string | null,
    params: { from: string; to: string; groupBy: ConnectedHoursGroupBy },
  ): Promise<ConnectedHoursReport> {
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    if (Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" parameter');
    }
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" parameter');
    }
    if (fromDate > toDate) {
      throw new BadRequestException('"from" must be ≤ "to"');
    }
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (diffDays > 366) {
      throw new BadRequestException('Range cannot exceed 366 days');
    }

    const orgFilter = orgId !== null ? sql`AND s.organization_id = ${orgId}::uuid` : sql``;

    // Hard-coded SQL fragments per groupBy value (defense-in-depth: removes
    // any interpolation of user-controlled strings into date_trunc / interval
    // expressions, even though Zod already restricts to 'day'|'week'|'month').
    // Trunc at UTC makes the period boundaries DST-independent so a week
    // crossing a DST switch is always exactly 168 hours.
    const truncUnit = (
      {
        day: sql`'day'`,
        week: sql`'week'`,
        month: sql`'month'`,
      } as const
    )[params.groupBy];
    const intervalExpr = (
      {
        day: sql`INTERVAL '1 day'`,
        week: sql`INTERVAL '1 week'`,
        month: sql`INTERVAL '1 month'`,
      } as const
    )[params.groupBy];
    const periodFormat = (
      {
        day: sql`to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        week: sql`to_char(period_start AT TIME ZONE 'UTC', 'IYYY-"W"IW')`,
        month: sql`to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM')`,
      } as const
    )[params.groupBy];

    const result = (await this.drizzleProvider.db.execute(sql`
      WITH periods AS (
        SELECT period_start,
               (period_start + ${intervalExpr}) AS period_end
          FROM generate_series(
                 date_trunc(${truncUnit}, ${params.from}::date::timestamptz, 'UTC'),
                 date_trunc(${truncUnit}, ${params.to}::date::timestamptz, 'UTC'),
                 ${intervalExpr}
               ) AS period_start
      ),
      session_overlaps AS (
        SELECT s.user_id,
               p.period_start,
               GREATEST(s.started_at, p.period_start) AS lo,
               LEAST(s.ended_at, p.period_end)        AS hi
          FROM user_sessions s
          JOIN periods p
            ON s.started_at < p.period_end
           AND s.ended_at   > p.period_start
         WHERE 1=1 ${orgFilter}
      )
      SELECT
        u.id                              AS "userId",
        u.full_name                       AS "userName",
        u.role::text                      AS "role",
        ${periodFormat}                   AS "period",
        to_char(o.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "periodStart",
        ROUND((SUM(EXTRACT(EPOCH FROM (o.hi - o.lo))) / 3600.0)::numeric, 2)::float AS "hours"
      FROM session_overlaps o
      JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
      GROUP BY u.id, u.full_name, u.role, o.period_start
      HAVING SUM(EXTRACT(EPOCH FROM (o.hi - o.lo))) > 0
      ORDER BY u.full_name, o.period_start
    `)) as unknown as ConnectedHoursRow[];

    return {
      groupBy: params.groupBy,
      from: params.from,
      to: params.to,
      rows: result.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        role: r.role,
        period: r.period,
        periodStart: r.periodStart,
        hours: numberOrZero(r.hours),
      })),
    };
  }
}
