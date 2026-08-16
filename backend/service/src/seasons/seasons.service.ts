import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  currentSeasonYear,
  resolveSeasonYear,
  seasonYearRange,
  type CloseSeasonResult,
  type SeasonContext,
  type SeasonPreflight,
} from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { FeaturesCacheService } from '../features/features-cache.service';
import {
  clampToSeason,
  seasonWindow,
  tsWindowClause,
  type DateWindow,
} from '../common/season-range';
import { depotStockBales, depotStockNetWeight } from '../common/depot-stock';

/**
 * How long a device may be silent before closing a season is flagged as risky.
 *
 * `bale_loads.loaded_at` is stamped with the SERVER's `NOW()`, so work done
 * offline is dated when it arrives, not when it happened. A phone that has been
 * dark for a day is therefore carrying bales that will land in the wrong
 * season. 24h is chosen to be longer than any plausible overnight gap and
 * shorter than "this phone is lost".
 */
const DEVICE_SILENT_HOURS = 24;

interface SeasonActor {
  userId: string;
  role: string;
}

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly featuresCache: FeaturesCacheService,
  ) {}

  private get db() {
    return this.drizzleProvider.db;
  }

  private orgClause(orgId: string | null, col = sql`organization_id`) {
    return orgId === null ? sql`` : sql` AND ${col} = ${orgId}::uuid`;
  }

  private async scalar(query: ReturnType<typeof sql>): Promise<number> {
    const rows = (await this.db.execute(query)) as unknown as { value: unknown }[];
    return Number(rows[0]?.value ?? 0);
  }

  /**
   * The window a request should read.
   *
   * The precedence is deliberate and must be identical on every endpoint:
   *
   *   1. super_admin reading across organizations -> NO season filter at all.
   *      It has no `organizationId`, so it has no active season either;
   *      filtering would silently hide other tenants' data behind one tenant's
   *      calendar. This mirrors the existing org-filter escapes in
   *      DashboardService and ReportsService.
   *   2. An explicit range -> honoured, but CLAMPED to the requested season if
   *      one was named. A report must not read across a season boundary just
   *      because a date picker was left on last month.
   *   3. A season alone -> that season's full year.
   *   4. Nothing -> the organization's active season. THIS is where "the
   *      statistics reset" comes from: no caller changes, and every all-time
   *      aggregate silently becomes a this-season aggregate.
   */
  resolveWindow(
    orgId: string | null,
    activeSeasonYear: number | null,
    query?: { season?: number } & DateWindow,
  ): DateWindow {
    if (orgId === null) return { dateFrom: query?.dateFrom, dateTo: query?.dateTo };

    const year = resolveSeasonYear(query?.season, activeSeasonYear);
    if (query?.dateFrom || query?.dateTo) {
      return clampToSeason(year, { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }
    return seasonWindow(year);
  }

  /** The season a request is actually reading, for callers that need the number. */
  resolveYear(
    orgId: string | null,
    activeSeasonYear: number | null,
    query?: { season?: number },
  ): number | undefined {
    if (orgId === null) return undefined;
    return resolveSeasonYear(query?.season, activeSeasonYear);
  }

  /**
   * The season an operational GATE must use.
   *
   * Never the season a user selected in a picker. A selector is a reporting
   * concern; whether a loader may load a field is a physical one, and letting a
   * dropdown change it would mean an admin browsing last year's report could
   * block a truck in a field.
   */
  gateYear(activeSeasonYear: number | null): number {
    return resolveSeasonYear(undefined, activeSeasonYear);
  }

  /** Seasons this org can show in a picker, plus which ones are frozen. */
  async getContext(orgId: string, activeSeasonYear: number | null): Promise<SeasonContext> {
    const rows = (await this.db.execute(
      sql`SELECT year, status FROM organization_seasons
           WHERE organization_id = ${orgId}::uuid
           ORDER BY year DESC`,
    )) as unknown as { year: number; status: string }[];

    const closedYears = rows.filter((r) => r.status === 'closed').map((r) => Number(r.year));
    // The earliest year we know about is the earliest recorded season, or -- for
    // an org that has never closed one -- the year of its oldest trip. Falling
    // back to the data rather than to `created_at` keeps the picker honest for
    // an org whose first season predates this feature.
    const earliest = rows.length
      ? Math.min(...rows.map((r) => Number(r.year)))
      : await this.earliestDataYear(orgId);

    return {
      activeSeasonYear: resolveSeasonYear(undefined, activeSeasonYear),
      availableYears: seasonYearRange(earliest),
      closedYears,
    };
  }

  private async earliestDataYear(orgId: string): Promise<number> {
    const rows = (await this.db.execute(
      sql`SELECT EXTRACT(YEAR FROM MIN(created_at) AT TIME ZONE 'Europe/Bucharest')::int AS value
            FROM trips
           WHERE organization_id = ${orgId}::uuid AND deleted_at IS NULL`,
    )) as unknown as { value: number | null }[];
    const year = rows[0]?.value;
    return year == null ? currentSeasonYear() : Number(year);
  }

  /** Whether writing into `year` is still allowed for this org. */
  async isSeasonClosed(orgId: string, year: number): Promise<boolean> {
    const rows = (await this.db.execute(
      sql`SELECT 1 AS value FROM organization_seasons
           WHERE organization_id = ${orgId}::uuid AND year = ${year} AND status = 'closed'
           LIMIT 1`,
    )) as unknown as { value: number }[];
    return rows.length > 0;
  }

  /**
   * The write guard.
   *
   * Throws `BadRequestException` with a stable `error` code, NOT a 404 or a
   * bare 500. The distinction is not cosmetic: mobile treats an unrecognised
   * failure as retryable and puts the mutation into quadratic backoff, where it
   * is destroyed after seven days along with the operator's work. A stable code
   * is what lets `push.ts` classify this as terminal, surface it, and stop.
   */
  async assertSeasonWritable(orgId: string | null, businessDate: Date | string): Promise<void> {
    if (orgId === null) return;
    const instant = typeof businessDate === 'string' ? new Date(businessDate) : businessDate;
    if (Number.isNaN(instant.getTime())) return;

    const year = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Bucharest',
        year: 'numeric',
      }).format(instant),
    );

    if (await this.isSeasonClosed(orgId, year)) {
      throw new BadRequestException({
        error: 'season_closed',
        message: `Sezonul ${year} este închis. Înregistrarea nu mai poate fi salvată.`,
        season: year,
      });
    }
  }

  /**
   * Everything the confirmation screen shows, with zero writes.
   *
   * Deliberately reuses the exact expressions the closing transaction will run,
   * so the preview cannot drift from the outcome.
   */
  async preflight(orgId: string, year: number): Promise<SeasonPreflight> {
    const window = seasonWindow(year);
    const current = currentSeasonYear();

    if (year >= current) {
      throw new BadRequestException({
        error: 'season_not_finished',
        message: `Sezonul ${year} nu s-a încheiat încă. Poți închide doar un an calendaristic trecut.`,
      });
    }
    if (await this.isSeasonClosed(orgId, year)) {
      throw new BadRequestException({
        error: 'season_already_closed',
        message: `Sezonul ${year} este deja închis.`,
      });
    }

    const [openTrips, devicesNotCheckedIn, unacknowledgedAlerts, parcelsToReset] =
      await Promise.all([
        this.scalar(sql`
          SELECT COUNT(*)::int AS value FROM trips t
           WHERE t.deleted_at IS NULL
             AND t.status NOT IN ('completed'::trip_status, 'cancelled'::trip_status)
             AND t.organization_id = ${orgId}::uuid
             ${tsWindowClause(sql`t.created_at`, window)}`),
        this.scalar(sql`
          SELECT COUNT(*)::int AS value FROM devices
           WHERE deleted_at IS NULL
             AND organization_id = ${orgId}::uuid
             AND (last_checkin_at IS NULL
                  OR last_checkin_at < NOW() - INTERVAL '${sql.raw(String(DEVICE_SILENT_HOURS))} hours')`),
        this.scalar(sql`
          SELECT COUNT(*)::int AS value FROM alerts a
           WHERE a.is_acknowledged = false
             AND a.organization_id = ${orgId}::uuid
             ${tsWindowClause(sql`a.created_at`, window)}`),
        this.scalar(sql`
          SELECT COUNT(*)::int AS value FROM parcels
           WHERE deleted_at IS NULL
             AND organization_id = ${orgId}::uuid
             AND harvest_status IS DISTINCT FROM 'planned'::harvest_status`),
      ]);

    const depots = await this.closingDepotStock(orgId, year);
    const withStock = depots.filter((d) => d.baleCount > 0);

    return {
      year,
      openTrips,
      devicesNotCheckedIn,
      unacknowledgedAlerts,
      depotsWithStock: withStock.length,
      balesCarriedForward: withStock.reduce((sum, d) => sum + d.baleCount, 0),
      parcelsToReset,
      // Open trips BLOCK: a season that is closed to writes cannot accept the
      // transitions those trips still need, so closing over them would strand a
      // truck mid-haul. Silent devices only WARN -- a lost or broken phone must
      // not make the year impossible to close, and the admin is told exactly
      // how many there are.
      canClose: openTrips === 0,
    };
  }

  /**
   * Every depot's stock as at the end of `year`.
   *
   * All-time up to the season's end, not just that season's movements: the
   * closing balance is what is physically in the building, which includes
   * whatever a previous season already carried in.
   */
  private async closingDepotStock(
    orgId: string,
    year: number,
  ): Promise<{ id: string; baleCount: number; netWeightKg: number }[]> {
    const upTo: DateWindow = { dateTo: `${year}-12-31` };
    const opts = {
      depotIdExpr: sql`d.id`,
      depotCoordsExpr: sql`d.coords`,
      orgId,
      window: upTo,
    };
    const rows = (await this.db.execute(sql`
      SELECT d.id,
             ${depotStockBales(opts)}     AS "baleCount",
             ${depotStockNetWeight(opts)} AS "netWeightKg"
        FROM delivery_destinations d
       WHERE d.deleted_at IS NULL AND d.organization_id = ${orgId}::uuid
    `)) as unknown as { id: string; baleCount: number; netWeightKg: string }[];

    return rows.map((r) => ({
      id: r.id,
      baleCount: Number(r.baleCount ?? 0),
      netWeightKg: Number(r.netWeightKg ?? 0),
    }));
  }

  /**
   * Close a season.
   *
   * Everything below runs in ONE transaction so a half-rolled-over
   * organization -- parcels reset but the season still open, or balances
   * written twice -- is not a reachable state. The advisory lock is
   * transaction-scoped and serializes concurrent attempts from two replicas;
   * it is the same idiom `generateTripNumber` uses to serialize trip-number
   * minting.
   */
  async close(
    orgId: string,
    year: number,
    reason: string,
    actor: SeasonActor,
  ): Promise<CloseSeasonResult> {
    const opening = year + 1;
    const closed = await this.db.transaction(async (tx): Promise<CloseSeasonResult> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`season-close:${orgId}`}))`);

      // Re-checked INSIDE the transaction. The preflight the admin looked at is
      // a snapshot from seconds ago; a trip could have been created since.
      const preflight = await this.preflight(orgId, year);
      if (!preflight.canClose) {
        throw new BadRequestException({
          error: 'season_has_open_work',
          message:
            `Sezonul ${year} are ${preflight.openTrips} curse nefinalizate. ` +
            `Finalizează-le sau anulează-le înainte de închidere.`,
          openTrips: preflight.openTrips,
        });
      }

      // 1. Snapshot the parcel state that is about to be reset. ON CONFLICT so a
      //    retry after a partial failure is a no-op rather than a duplicate.
      const snapshotted = await tx.execute(sql`
        INSERT INTO parcel_season_snapshots
          (organization_id, season_year, parcel_id, harvest_status, crop_type,
           bales_produced, bales_loaded)
        SELECT p.organization_id, ${year}, p.id, p.harvest_status, p.crop_type,
               COALESCE((SELECT SUM(bp.bale_count) FROM bale_productions bp
                          WHERE bp.parcel_id = p.id AND bp.deleted_at IS NULL
                            AND bp.production_date >= ${`${year}-01-01`}::date
                            AND bp.production_date <= ${`${year}-12-31`}::date), 0)::int,
               COALESCE((SELECT SUM(bl.bale_count) FROM bale_loads bl
                          WHERE bl.parcel_id = p.id AND bl.deleted_at IS NULL
                            AND bl.loaded_at >= (${`${year}-01-01`}::date::timestamp AT TIME ZONE 'Europe/Bucharest')
                            AND bl.loaded_at < ((${`${year}-12-31`}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Bucharest')), 0)::int
          FROM parcels p
         WHERE p.deleted_at IS NULL AND p.organization_id = ${orgId}::uuid
        ON CONFLICT (organization_id, season_year, parcel_id) DO NOTHING
        RETURNING id`);

      // 2. Carry the depot stock into the opening season.
      const depots = await this.closingDepotStock(orgId, year);
      const withStock = depots.filter((d) => d.baleCount > 0 || d.netWeightKg > 0);
      for (const depot of withStock) {
        await tx.execute(sql`
          INSERT INTO season_opening_balances
            (organization_id, season_year, depot_id, bale_count, net_weight_kg,
             source_season_year, created_by)
          VALUES (${orgId}::uuid, ${opening}, ${depot.id}::uuid,
                  ${depot.baleCount}, ${depot.netWeightKg}, ${year}, ${actor.userId}::uuid)
          ON CONFLICT (organization_id, season_year, depot_id) DO NOTHING`);
      }

      // 3. Reset the seasonal state on parcels.
      //
      //    `harvest_status` only ever moves forward -- trg_prevent_harvest_-
      //    status_downgrade raises check_violation on any backward step -- so a
      //    reset is by definition illegal without the documented bypass. The
      //    GUC is transaction-scoped, and asserted rather than assumed: if a
      //    future pooling change ever swallowed the SET, the UPDATE would abort
      //    mid-rollover instead of silently skipping the reset.
      //
      //    `IS DISTINCT FROM` keeps the blast radius to the rows that actually
      //    change. Every touched row gets a fresh sync_version from the global
      //    sequence and re-pulls to that org's phones, 1000 rows per table per
      //    cycle, so touching 341 already-planned parcels for nothing would be
      //    a real cost.
      //
      //    `crop_type` is deliberately NOT reset: it is admin-entered master
      //    data and rotation is an explicit decision, not a yearly blanking.
      //    It is preserved in the snapshot above.
      await tx.execute(sql`SET LOCAL app.allow_harvest_downgrade = 'on'`);
      const bypass = (await tx.execute(
        sql`SELECT current_setting('app.allow_harvest_downgrade', true) AS value`,
      )) as unknown as { value: string | null }[];
      if (bypass[0]?.value !== 'on') {
        throw new BadRequestException({
          error: 'season_reset_bypass_unavailable',
          message:
            'Nu s-a putut dezactiva protecția de status recoltare. Închiderea a fost oprită.',
        });
      }

      const reset = await tx.execute(sql`
        UPDATE parcels
           SET harvest_status = 'planned'::harvest_status, updated_at = NOW()
         WHERE deleted_at IS NULL
           AND organization_id = ${orgId}::uuid
           AND harvest_status IS DISTINCT FROM 'planned'::harvest_status
        RETURNING id`);

      // 4. Restart comandă numbering. The rendered number is qualified with the
      //    year of the request it belongs to, so restarting cannot collide with
      //    last season's numbers.
      const counters = await tx.execute(sql`
        UPDATE beneficiary_order_settings
           SET order_counter = 0
         WHERE organization_id = ${orgId}::uuid AND order_counter <> 0
        RETURNING id`);

      // 5. Freeze the season. Guarded on the absence of a closed row rather
      //    than blindly upserting, so a concurrent close loses instead of
      //    double-applying.
      await tx.execute(sql`
        INSERT INTO organization_seasons
          (organization_id, year, status, closed_at, closed_by, closing_note)
        VALUES (${orgId}::uuid, ${year}, 'closed', NOW(), ${actor.userId}::uuid, ${reason})
        ON CONFLICT (organization_id, year)
        DO UPDATE SET status = 'closed', closed_at = NOW(),
                      closed_by = ${actor.userId}::uuid, closing_note = ${reason}
        WHERE organization_seasons.status <> 'closed'`);

      // 6. Record the opening season and flip the read default.
      await tx.execute(sql`
        INSERT INTO organization_seasons (organization_id, year, status)
        VALUES (${orgId}::uuid, ${opening}, 'open')
        ON CONFLICT (organization_id, year) DO NOTHING`);

      await tx.execute(sql`
        UPDATE organizations SET active_season_year = ${opening}, updated_at = NOW()
         WHERE id = ${orgId}::uuid AND deleted_at IS NULL`);

      return {
        closedYear: year,
        newActiveYear: opening,
        depotBalancesWritten: withStock.length,
        balesCarriedForward: withStock.reduce((sum, d) => sum + d.baleCount, 0),
        parcelsSnapshotted: (snapshotted as unknown as unknown[]).length,
        parcelsReset: (reset as unknown as unknown[]).length,
        orderCountersReset: (counters as unknown as unknown[]).length,
      };
    });

    // After COMMIT, never before: a generation bump seen by the other replica
    // ahead of the data would make it re-read the OLD active_season_year and
    // cache it under the NEW generation -- pinning the whole org to last season
    // until the TTL expired.
    await this.featuresCache.bump();

    this.logger.log(
      `flow season.close org=${orgId} year=${year} -> ${opening} ` +
        `by=${actor.userId} depots=${closed.depotBalancesWritten} ` +
        `bales=${closed.balesCarriedForward} parcelsReset=${closed.parcelsReset}`,
    );

    return closed;
  }
}
