import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type {
  FarmReport,
  FieldReport,
  DepotReport,
  ReportTimelinePoint,
} from '@strawboss/types';

interface ReportDateRange {
  dateFrom?: string;
  dateTo?: string;
}

/** Synthetic farm name for parcels not assigned to any farm. */
const FARMLESS_NAME = 'Fără fermă';

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
      parts.push(
        sql`${colExpr} >= ${`${range.dateFrom}T00:00:00.000Z`}::timestamptz`,
      );
    }
    if (range?.dateTo) {
      parts.push(
        sql`${colExpr} <= ${`${range.dateTo}T23:59:59.999Z`}::timestamptz`,
      );
    }
    if (parts.length === 0) return sql``;
    return sql` AND ${sql.join(parts, sql` AND `)}`;
  }

  /**
   * Production per farm, with a per-field (parcel) breakdown.
   * Parcels with no farm fall into a synthetic "Fără fermă" bucket.
   */
  async getFarmReports(
    orgId: string | null,
    range?: ReportDateRange,
  ): Promise<FarmReport[]> {
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
      const produced = Number(row.produced) || 0;
      const loaded = Number(row.loaded) || 0;
      const delivered = Number(row.delivered) || 0;

      const field: FieldReport = {
        parcelId: row.parcel_id as string,
        parcelName: row.parcel_name as string,
        parcelCode: (row.parcel_code as string) ?? '',
        produced,
        loaded,
        delivered,
        lossPercentage:
          produced > 0
            ? Math.max(0, ((produced - delivered) / produced) * 100)
            : 0,
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
          ? Math.max(
              0,
              ((farm.produced - farm.delivered) / farm.produced) * 100,
            )
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
  async getDepotReports(
    orgId: string | null,
    range?: ReportDateRange,
  ): Promise<DepotReport[]> {
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
        COALESCE((
          SELECT SUM(t.bale_count)::int
          FROM trips t
          WHERE t.destination_name = d.name
            AND t.status IN ('delivered', 'completed')
            AND t.deleted_at IS NULL ${tripOrg}
        ), 0) AS total_stock,
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
      totalStock: Number(row.total_stock) || 0,
      receivedInPeriod: Number(row.received_in_period) || 0,
      arrivingNow: Number(row.arriving_now) || 0,
      deliveryCount: Number(row.delivery_count) || 0,
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
      const spanDays =
        (Date.parse(range.dateTo) - Date.parse(range.dateFrom)) / 86_400_000;
      if (spanDays > MAX_RANGE_DAYS) {
        throw new BadRequestException(
          `Date range exceeds ${MAX_RANGE_DAYS} days`,
        );
      }
    }

    const to = range?.dateTo ?? new Date().toISOString().slice(0, 10);
    let from = range?.dateFrom;
    if (!from) {
      const d = new Date(`${to}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 29);
      from = d.toISOString().slice(0, 10);
    }

    const bpOrg = this.orgFilter(orgId, sql`bp.organization_id`);
    const tripOrg = this.orgFilter(orgId, sql`t.organization_id`);
    const farmFilter = farmId
      ? sql` AND p.farm_id = ${farmId}::uuid`
      : sql``;

    const result = await this.drizzleProvider.db.execute(sql`
      WITH dates AS (
        SELECT generate_series(${from}::date, ${to}::date, '1 day')::date AS d
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
      produced: Number(row.produced) || 0,
      loaded: Number(row.loaded) || 0,
      delivered: Number(row.delivered) || 0,
    }));
  }
}
