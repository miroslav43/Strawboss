import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  currentSeasonYear,
  resolveSeasonYear,
  seasonYearRange,
  SEASON_MAX_YEAR,
  SEASON_MIN_YEAR,
  type CloseSeasonResult,
  type SeasonContext,
  type SeasonPreflight,
} from '@strawboss/types';
import { seasonYearSchema } from '@strawboss/validation';
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

/** Matches the AuthGuard user-context TTL — a season changes once a year. */
const ACTIVE_YEAR_TTL_MS = 60_000;

interface SeasonActor {
  userId: string;
  role: string;
}

/**
 * Anything that can run a statement — the pool, or one transaction's pinned
 * connection.
 *
 * Threaded explicitly rather than reached for via `this.db`, mirroring
 * `TripsService.generateTripNumber(orgId, executor)`. Two reasons, and the
 * first is correctness:
 *
 *   * A read issued on `this.db` from inside a `db.transaction()` callback runs
 *     on a DIFFERENT connection, so it cannot see the transaction's uncommitted
 *     state and is not protected by its advisory lock. `close()` re-runs the
 *     preflight precisely to catch work created since the admin looked at it —
 *     a check that means nothing if it reads outside the transaction.
 *   * The pool is capped at 4 connections per replica (drizzle.provider.ts). A
 *     transaction pins one while the preflight's Promise.all asks for four
 *     more, so the excess queues behind the very transaction that is waiting
 *     for it.
 */
type Executor = Pick<DrizzleProvider['db'], 'execute'>;

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);

  /** Per-org active season, invalidated by the shared generation token. */
  private readonly activeYearCache = new Map<
    string,
    { at: number; gen: number; year: number | undefined }
  >();

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly featuresCache: FeaturesCacheService,
  ) {}

  private get db() {
    return this.drizzleProvider.db;
  }

  private async scalar(
    query: ReturnType<typeof sql>,
    executor: Executor = this.db,
  ): Promise<number> {
    const rows = (await executor.execute(query)) as unknown as { value: unknown }[];
    return Number(rows[0]?.value ?? 0);
  }

  /**
   * Parse a `?season=` / `:year` value from a request into a season year.
   *
   * Exists because calling `seasonYearSchema.parse()` straight from a
   * controller throws a raw `ZodError`, which is an `Error` but NOT an
   * `HttpException` — so `AllExceptionsFilter` leaves the status at its 500
   * default and ships the stringified Zod issue array to the client as the
   * message. A typo in a query string then reads as "the server crashed" and
   * lands in the error log at error level.
   *
   * That is precisely the failure `ZodValidationPipe` was written to end (see
   * its own header comment, and the six days a field loader spent blocked by
   * a validation error disguised as an internal error). Route and query params
   * that cannot go through the pipe come through here instead.
   */
  parseSeasonParam(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = seasonYearSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_season',
        message: `Sezon invalid: „${value}". Aștept un an între ${SEASON_MIN_YEAR} și ${SEASON_MAX_YEAR}.`,
      });
    }
    return parsed.data;
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
   *   4. Nothing, and the org HAS closed a season -> its active season. This is
   *      where "the statistics reset" comes from: no caller changes, and every
   *      all-time aggregate silently becomes a this-season aggregate.
   *   5. Nothing, and the org has NEVER closed a season -> NO FILTER AT ALL.
   *
   * Rule 5 is the safety property that makes this whole feature shippable.
   *
   * Falling back to "the current calendar year" instead would arm every filter
   * automatically at midnight on 1 January, before any human decided anything.
   * The operational gate would be the casualty: bales baled in December and
   * still lying in the field would become unloadable overnight, and the loader
   * standing in front of them would get `parcel_fully_loaded` with no
   * explanation and no admin action to point at.
   *
   * So an organization that has never closed a season behaves EXACTLY as it did
   * before seasons existed. The filtering starts the moment the admin closes
   * the first season -- having read a preflight that says, in counts, what is
   * about to happen.
   */
  resolveWindow(
    orgId: string | null,
    activeSeasonYear: number | null,
    query?: { season?: number } & DateWindow,
  ): DateWindow {
    const year = this.resolveYear(orgId, activeSeasonYear, query);
    if (year === undefined) return { dateFrom: query?.dateFrom, dateTo: query?.dateTo };
    if (query?.dateFrom || query?.dateTo) {
      return clampToSeason(year, { dateFrom: query.dateFrom, dateTo: query.dateTo });
    }
    return seasonWindow(year);
  }

  /**
   * The season a request is actually reading, or `undefined` for "all time".
   *
   * `undefined` in two distinct situations that must behave identically:
   * super_admin reading across tenants (it has no season of its own, and
   * filtering would hide other tenants behind one tenant's calendar), and an
   * organization that has never closed a season (rule 5 above).
   */
  resolveYear(
    orgId: string | null,
    activeSeasonYear: number | null,
    query?: { season?: number },
  ): number | undefined {
    if (orgId === null) return undefined;
    if (query?.season !== undefined) return resolveSeasonYear(query.season, activeSeasonYear);
    return activeSeasonYear ?? undefined;
  }

  /**
   * The season an operational GATE must use, or `undefined` for "all time".
   *
   * Never the season a user selected in a picker. A selector is a reporting
   * concern; whether a loader may load a field is a physical one, and letting a
   * dropdown change it would mean an admin browsing last year's report could
   * block a truck standing in a field.
   */
  gateYear(orgId: string | null, activeSeasonYear: number | null): number | undefined {
    return this.resolveYear(orgId, activeSeasonYear);
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

  /**
   * The org's active season, resolved from the database rather than threaded
   * through a call chain.
   *
   * Exists because threading `seasonYear` as an optional trailing parameter was
   * tried first and failed the way optional trailing parameters always do: of
   * the five call sites that ask "how many bales are left on this field", only
   * the one being edited got the argument. The other four silently kept the
   * all-time window, so two gates answering the same physical question could
   * disagree — including one that blocks a driver from starting a trip.
   *
   * A service that resolves this itself cannot be called wrongly. Cached per org
   * behind the same TTL + generation token the feature flags use, so the gates
   * on the hot registerLoad path cost no query, and a rollover invalidates it
   * across replicas.
   */
  async getActiveSeasonYear(orgId: string | null): Promise<number | undefined> {
    if (!orgId) return undefined;

    const gen = this.featuresCache.currentGeneration();
    const now = Date.now();
    const cached = this.activeYearCache.get(orgId);
    if (cached && cached.gen === gen && now - cached.at < ACTIVE_YEAR_TTL_MS) {
      return cached.year;
    }

    const rows = (await this.db.execute(
      sql`SELECT active_season_year AS "activeSeasonYear"
            FROM organizations
           WHERE id = ${orgId}::uuid AND deleted_at IS NULL
           LIMIT 1`,
    )) as unknown as { activeSeasonYear: number | null }[];

    // A missing org resolves to "no season filter" rather than throwing: this
    // runs inside operational gates, where an exception would block field work
    // over a bookkeeping question.
    const raw = rows[0]?.activeSeasonYear;
    const year = raw == null ? undefined : Number(raw);
    this.activeYearCache.set(orgId, { at: now, gen, year });
    return year;
  }

  /** Whether writing into `year` is still allowed for this org. */
  async isSeasonClosed(
    orgId: string,
    year: number,
    executor: Executor = this.db,
  ): Promise<boolean> {
    const rows = (await executor.execute(
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
  async assertSeasonWritable(
    orgId: string | null,
    businessDate: Date | string,
    executor: Executor = this.db,
  ): Promise<void> {
    if (orgId === null) return;
    const instant = typeof businessDate === 'string' ? new Date(businessDate) : businessDate;
    if (Number.isNaN(instant.getTime())) return;

    const year = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Bucharest',
        year: 'numeric',
      }).format(instant),
    );

    if (await this.isSeasonClosed(orgId, year, executor)) {
      throw new BadRequestException({
        error: 'season_closed',
        // Romanian safety net (byte-identical to the pre-i18n literal) — the
        // real, locale-correct text is resolved by AllExceptionsFilter from
        // `i18nKey` below, using the caller's `request.user.locale` (both
        // call sites — bale-productions.controller.ts and sync.service.ts —
        // run inside an authenticated request, so that locale is available).
        // Task 6.4: mobile's sync/push.ts classifies `error: 'season_closed'`
        // as terminal and can surface `message` to the operator verbatim.
        message: `Sezonul ${year} este închis. Înregistrarea nu mai poate fi salvată.`,
        i18nKey: 'errors.seasonClosed',
        i18nParams: { year },
        season: year,
      });
    }
  }

  /**
   * Everything the confirmation screen shows, with zero writes.
   *
   * Deliberately reuses the exact expressions the closing transaction will run,
   * so the preview cannot drift from the outcome.
   *
   * `season_not_finished` / `season_already_closed` below are deliberately
   * left un-i18n'd (Task 6.4): both only fire from the season-close admin
   * action (admin-web's own settings page), never from a field operator's
   * write — unlike `assertSeasonWritable`'s `season_closed` above.
   */
  async preflight(
    orgId: string,
    year: number,
    executor: Executor = this.db,
  ): Promise<SeasonPreflight> {
    const window = seasonWindow(year);
    const current = currentSeasonYear();

    if (year >= current) {
      throw new BadRequestException({
        error: 'season_not_finished',
        message: `Sezonul ${year} nu s-a încheiat încă. Poți închide doar un an calendaristic trecut.`,
      });
    }
    if (await this.isSeasonClosed(orgId, year, executor)) {
      throw new BadRequestException({
        error: 'season_already_closed',
        message: `Sezonul ${year} este deja închis.`,
      });
    }

    const [openTrips, devicesNotCheckedIn, unacknowledgedAlerts, parcelsToReset] =
      await Promise.all([
        this.scalar(
          sql`
          SELECT COUNT(*)::int AS value FROM trips t
           WHERE t.deleted_at IS NULL
             AND t.status NOT IN ('completed'::trip_status, 'cancelled'::trip_status)
             AND t.organization_id = ${orgId}::uuid
             ${tsWindowClause(sql`t.created_at`, window)}`,
        ),
        this.scalar(
          sql`
          SELECT COUNT(*)::int AS value FROM devices
           WHERE deleted_at IS NULL
             AND organization_id = ${orgId}::uuid
             AND (last_checkin_at IS NULL
                  OR last_checkin_at < NOW() - INTERVAL '${sql.raw(String(DEVICE_SILENT_HOURS))} hours')`,
        ),
        this.scalar(
          sql`
          SELECT COUNT(*)::int AS value FROM alerts a
           WHERE a.is_acknowledged = false
             AND a.organization_id = ${orgId}::uuid
             ${tsWindowClause(sql`a.created_at`, window)}`,
        ),
        this.scalar(
          sql`
          SELECT COUNT(*)::int AS value FROM parcels
           WHERE deleted_at IS NULL
             AND organization_id = ${orgId}::uuid
             AND harvest_status IS DISTINCT FROM 'planned'::harvest_status`,
        ),
      ]);

    const depots = await this.closingDepotStock(orgId, year, executor);
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
    executor: Executor = this.db,
  ): Promise<{ id: string; baleCount: number; netWeightKg: number }[]> {
    const upTo: DateWindow = { dateTo: `${year}-12-31` };
    const opts = {
      depotIdExpr: sql`d.id`,
      depotCoordsExpr: sql`d.coords`,
      orgId,
      window: upTo,
    };
    const rows = (await executor.execute(sql`
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
      const preflight = await this.preflight(orgId, year, tx);
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
      const depots = await this.closingDepotStock(orgId, year, tx);
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
    this.activeYearCache.delete(orgId);
    await this.featuresCache.bump();

    this.logger.log(
      `flow season.close org=${orgId} year=${year} -> ${opening} ` +
        `by=${actor.userId} depots=${closed.depotBalancesWritten} ` +
        `bales=${closed.balesCarriedForward} parcelsReset=${closed.parcelsReset}`,
    );

    return closed;
  }
}
