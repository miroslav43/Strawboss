import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { todayInRomania } from '../common/date';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryDestinationsService } from '../delivery-destinations/delivery-destinations.service';
import { ParcelsService } from '../parcels/parcels.service';
import { AlertsService } from '../alerts/alerts.service';
import { MESSAGING_SERVICE, type IMessagingService } from '../messaging/messaging.tokens';
import { messageTemplates, fmtCoordsUrl } from '../messaging/message-templates';
import { TripStatus, MessageKind, type UserRole, type PublicSignInfo } from '@strawboss/types';
import { QUEUE_CMR_GENERATION, QUEUE_TRIP_AUTOCOMPLETE } from '../jobs/queues';
import type {
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  ConfirmDepotDeliveryDto,
  ForceStatusDto,
  CompleteDto,
  CancelDto,
  DisputeDto,
  ResolveDisputeDto,
  RegisterLoadDto,
  RegisterLoadResult,
} from '@strawboss/types';
import { getAvailableTransitions, DEFAULT_MAX_BALES_PER_TRUCK } from '@strawboss/domain';

/**
 * How long an auxiliary trip sits in `loaded` before it auto-completes. Aux
 * trips have a collapsed lifecycle (planned → loaded → completed): the loader
 * finishing the load lands it on `loaded`, and this delayed job flips it to
 * `completed`. Fixed at 5 minutes.
 */
const AUX_AUTOCOMPLETE_DELAY_MS = 5 * 60_000;

/**
 * A bare calendar day, as an <input type="date"> sends it. Mobile instead sends
 * a full UTC ISO instant (startOfDayRomaniaISO), so the two shapes must be told
 * apart before any `::date` cast — see the date handling in list().
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hard cap on the trips list. NOT caller-overridable — see the note on the
 * controller: several admin pages fetch a wide window and filter it client-side,
 * so a caller-supplied limit would truncate before their filter runs.
 */
const TRIP_LIST_CAP = 1000;

/** Row shape used by recordNoRecall + alertAdminTruckReleased (P1b). */
interface TruckReleaseRow {
  id: string;
  status: string;
  recall_decision: string | null;
  recall_decided_at: string | null;
  truck_id: string | null;
  source_parcel_id: string | null;
  completed_at: string | null;
  root_id: string;
  organization_id: string | null;
  truck_code: string | null;
}

/**
 * register-load input. A load is EITHER parcel-sourced (`parcelId` set,
 * `sourceDepotId` null) OR depot-sourced (`sourceDepotId` set, `parcelId` null).
 * The `registerLoadSchema` Zod pipe enforces "exactly one of" at the boundary;
 * this local type widens the shared `RegisterLoadDto` (whose `parcelId` is still
 * required) so the depot branch can read `sourceDepotId` and treat `parcelId` as
 * optional without touching the shared `@strawboss/types` package.
 */
type RegisterLoadInput = Omit<RegisterLoadDto, 'parcelId'> & {
  parcelId?: string | null;
  sourceDepotId?: string | null;
};

@Injectable()
export class TripsService implements OnModuleInit {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
    @InjectQueue(QUEUE_CMR_GENERATION) private readonly cmrQueue: Queue,
    @InjectQueue(QUEUE_TRIP_AUTOCOMPLETE) private readonly tripAutocompleteQueue: Queue,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly deliveryDestinationsService: DeliveryDestinationsService,
    private readonly parcelsService: ParcelsService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
  ) {}

  /** Public web base URL for driver-facing links (sign-and-leave). */
  private publicWebBaseUrl(): string {
    return (
      this.configService.get<string>('NEXT_PUBLIC_SITE_URL') ??
      this.configService.get<string>('PUBLIC_WEB_URL') ??
      'https://nortiauno.com'
    ).replace(/\/$/, '');
  }

  /**
   * On boot, reconcile any truck task_assignments that were fully wired
   * up (parent loader + destination) but never had a Trip materialized —
   * e.g. created before this feature shipped, or during a window where
   * auto-upsert errored out. Idempotent: only rows with trip_id IS NULL.
   */
  async onModuleInit(): Promise<void> {
    // Guard this boot backfill with a global advisory lock: when both API
    // replicas cold-start at once (VM reboot / first stack deploy), only ONE may
    // run the scan. Otherwise two replicas can materialize the SAME truck task
    // into two duplicate trips — the INSERT path (autoUpsertFromTruckTask)
    // re-checks nothing atomically. The lock is session-scoped, so it must be
    // acquired AND released on one pinned connection (postgres.js pools by
    // default); we reserve a dedicated connection for the lock's lifetime.
    const lock = await this.drizzleProvider.client.reserve().catch((err) => {
      this.winston.error('Auto-trip backfill: could not reserve boot-lock connection', {
        context: 'TripsService',
        err: err instanceof Error ? { message: err.message } : err,
      });
      return null;
    });
    if (!lock) return;

    let acquired = false;
    try {
      const lockRows = (await lock`
        SELECT pg_try_advisory_lock(hashtext('strawboss:trip-backfill')) AS locked
      `) as unknown as { locked: boolean }[];
      if (!lockRows[0]?.locked) return; // another replica owns the backfill this boot
      acquired = true;

      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT ta.id
            FROM task_assignments ta
            JOIN machines m ON m.id = ta.machine_id
            WHERE m.machine_type = 'truck'
              AND ta.deleted_at IS NULL
              AND ta.trip_id IS NULL
              AND ta.parent_assignment_id IS NOT NULL
              AND ta.destination_id IS NOT NULL`,
      )) as unknown as { id: string }[];
      if (rows.length === 0) return;

      this.winston.log(
        'flow',
        `Auto-trip backfill: reconciling ${rows.length} truck task(s) on boot`,
        { context: 'TripsService', count: rows.length },
      );
      for (const row of rows) {
        try {
          await this.autoUpsertFromTruckTask(row.id);
        } catch (err) {
          this.winston.warn(`Auto-trip backfill failed for task ${row.id}`, {
            context: 'TripsService',
            taskId: row.id,
            err: err instanceof Error ? { message: err.message } : err,
          });
        }
      }
    } catch (err) {
      // Never block boot — log and move on.
      this.winston.error('Auto-trip backfill scan failed on boot', {
        context: 'TripsService',
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    } finally {
      if (acquired) {
        try {
          await lock`SELECT pg_advisory_unlock(hashtext('strawboss:trip-backfill'))`;
        } catch {
          // best-effort: the lock auto-frees when the reserved connection closes
        }
      }
      lock.release();
    }
  }

  private async pushToDriver(
    tripId: string,
    title: string,
    body: string,
    type: string,
  ): Promise<void> {
    try {
      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT driver_id FROM trips WHERE id = ${tripId} AND driver_id IS NOT NULL LIMIT 1`,
      )) as unknown as { driver_id: string }[];
      if (rows[0]?.driver_id) {
        await this.notificationsService.sendPush(rows[0].driver_id, title, body, { type, tripId });
      }
    } catch {
      // Best-effort — never fail a trip transition due to push error
    }
  }

  private logTripFlow(tripId: string, event: string, fromStatus: string, toStatus: string): void {
    this.winston.log('flow', `Trip ${tripId} ${event}: ${fromStatus} → ${toStatus}`, {
      context: 'TripsService',
      tripId,
      event,
      fromStatus,
      toStatus,
    });
  }

  async list(
    orgId: string | null,
    filters?: {
      status?: string; // single value OR comma-separated values (e.g. "planned,loading")
      driverId?: string;
      truckId?: string;
      sourceParcelId?: string;
      loaderOperatorId?: string;
      dateFrom?: string;
      dateTo?: string;
      /**
       * Opt-in enrichment for mobile list screens (e.g. useMyTrucksToLoad)
       * that would otherwise fan out one GET /machines/:id + one
       * GET /parcels/:id per row every poll. Pass `include=refs` to also get
       * the truck's full registration plate / internal code on each row.
       *
       * NOTE: `truck_plate`/`truck_code` (abbreviated) and
       * `source_parcel_name`/`source_parcel_code` are ALREADY selected
       * unconditionally below — admin-web's trips table depends on them being
       * present on every response, param or not — so they are NOT duplicated
       * here. `include=refs` only adds the two genuinely new columns
       * (truck_registration_plate/truck_internal_code); omitting the param
       * keeps the response byte-identical to today.
       */
      include?: string;
      /**
       * Opt-in split between the two kinds of trip. Pass the literal string
       * 'true' (auxiliary — external transporter, collapsed lifecycle) or
       * 'false' (own fleet). Omitting it returns BOTH, unchanged.
       */
      isAuxiliary?: string;
      /** Free-text over trip number / truck / driver (incl. external) / destination / parcel. */
      search?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`t.deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`t.organization_id = ${orgId}::uuid`);
    }

    if (filters?.status) {
      const statuses = filters.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(sql`t.status = ${statuses[0]}::trip_status`);
      } else if (statuses.length > 1) {
        const castList = sql.join(
          statuses.map((s) => sql`${s}::trip_status`),
          sql`, `,
        );
        conditions.push(sql`t.status IN (${castList})`);
      }
    }
    if (filters?.driverId) {
      conditions.push(sql`t.driver_id = ${filters.driverId}`);
    }
    if (filters?.truckId) {
      conditions.push(sql`t.truck_id = ${filters.truckId}`);
    }
    if (filters?.sourceParcelId) {
      conditions.push(sql`t.source_parcel_id = ${filters.sourceParcelId}`);
    }
    if (filters?.loaderOperatorId) {
      conditions.push(sql`t.loader_operator_id = ${filters.loaderOperatorId}`);
    }

    /*
     * `isAuxiliary` is STRICTLY opt-in: the predicate is pushed only on the
     * literal 'true'/'false'. Absent (or anything else) leaves the result set
     * untouched, so every existing caller keeps its current rows. This is the
     * same opt-in contract already documented for `include=refs` above, and it
     * is not optional here: the mobile loader's "Încărcări" tab reaches THIS
     * generic endpoint (useMyTrucksToLoad) and legitimately expects auxiliary
     * trips back — the aux INSERT sets loader_id/loader_operator_id. A default
     * that excluded aux would blank ~30 fleet phones with no error anywhere.
     */
    if (filters?.isAuxiliary === 'true' || filters?.isAuxiliary === 'false') {
      conditions.push(sql`t.is_auxiliary = ${filters.isAuxiliary === 'true'}`);
    }

    if (filters?.search) {
      const like = `%${filters.search}%`;
      // external_driver_name must be in here: an auxiliary trip has driver_id
      // NULL, so u.full_name is always NULL and the truck's driver would
      // otherwise be unsearchable.
      conditions.push(sql`(
        t.trip_number          ILIKE ${like} OR
        t.destination_name     ILIKE ${like} OR
        t.external_driver_name ILIKE ${like} OR
        m.registration_plate   ILIKE ${like} OR
        m.internal_code        ILIKE ${like} OR
        u.full_name            ILIKE ${like} OR
        p.name                 ILIKE ${like}
      )`);
    }

    /*
     * Date bounds carry TWO different wire shapes and must not be normalized
     * into one:
     *
     *   admin-web  sends a bare calendar day  '2026-07-13'   (an <input type=date>)
     *   mobile     sends a full UTC instant   '2026-07-12T21:00:00.000Z'
     *              (startOfDayRomaniaISO() — apps/mobile/src/lib/date.ts)
     *
     * Casting the mobile value with `::date` would truncate it to 2026-07-12 in
     * the UTC session and open the loader's window ~21h early, silently, on
     * every fleet phone. So the timezone-aware treatment is applied ONLY to a
     * bare calendar day; anything else falls through to the original predicate
     * byte-for-byte.
     *
     * For a bare day the bound is anchored to Europe/Bucharest and dateTo is
     * made INCLUSIVE (< next midnight) — `created_at <= '2026-07-13'` coerces to
     * midnight and drops everything created during that day.
     *
     * The `::timestamp` cast before AT TIME ZONE is LOAD-BEARING, not noise.
     * AT TIME ZONE picks its direction from the operand's type, and a bare
     * `date` prefers the implicit cast to timestamptz:
     *   date::timestamptz AT TIME ZONE z -> timestamp   ("wall-clock in z at this instant")
     *   date::timestamp   AT TIME ZONE z -> timestamptz ("this wall-clock, read as local time in z")
     * Only the second is what we mean. Without the cast the bound lands 2-3h off
     * (verified against the DB). With it, `'2026-07-13'` resolves to exactly
     * 2026-07-12T21:00:00Z — bit-identical to what mobile's startOfDayRomaniaISO()
     * sends — and it follows DST rather than hardcoding an offset.
     */
    if (filters?.dateFrom) {
      conditions.push(
        CALENDAR_DAY.test(filters.dateFrom)
          ? sql`t.created_at >= (${filters.dateFrom}::date::timestamp AT TIME ZONE 'Europe/Bucharest')`
          : sql`t.created_at >= ${filters.dateFrom}`,
      );
    }
    if (filters?.dateTo) {
      conditions.push(
        CALENDAR_DAY.test(filters.dateTo)
          ? sql`t.created_at < ((${filters.dateTo}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Bucharest')`
          : sql`t.created_at <= ${filters.dateTo}`,
      );
    }

    const where = sql.join(conditions, sql` AND `);
    // LEFT JOIN destinations/machines/users so the admin table can show
    // human-readable labels without per-row lookups.
    // Trips already store `destination_name` inline (denormalized on create),
    // so we only need to enrich truck / driver / source-parcel labels here.
    //
    // `refsSelect` reuses this SAME `m` join (no extra JOIN, no extra cost) to
    // add the two `include=refs` columns. When the param is absent this is an
    // empty fragment.
    //
    // `sd` (source depot) is a NEW unconditional join. Migration 00073 added
    // trips.source_depot_id, but the name was never joined — so a depot-sourced
    // trip has source_parcel_id NULL by construction and its Sursă cell was
    // permanently blank. This adds exactly ONE key (`source_depot_name`) to
    // every row: additive, and safe for the mobile callers, which map explicit
    // named fields and ignore unknown keys.
    const refsSelect =
      filters?.include === 'refs'
        ? sql`,
          m.registration_plate                         AS truck_registration_plate,
          m.internal_code                              AS truck_internal_code`
        : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`
        SELECT
          t.*,
          m.registration_plate                         AS truck_plate,
          m.internal_code                              AS truck_code,
          u.full_name                                  AS driver_name,
          p.name                                       AS source_parcel_name,
          p.code                                       AS source_parcel_code,
          p.municipality                               AS source_parcel_municipality,
          f.name                                       AS source_farm_name,
          sd.name                                      AS source_depot_name${refsSelect}
        FROM trips t
        LEFT JOIN machines m ON m.id = t.truck_id
        LEFT JOIN users    u ON u.id = t.driver_id
        LEFT JOIN parcels  p ON p.id = t.source_parcel_id
        LEFT JOIN farms    f ON f.id = p.farm_id
        LEFT JOIN delivery_destinations sd ON sd.id = t.source_depot_id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT ${TRIP_LIST_CAP}
      `,
    );
    return result;
  }

  async findById(id: string, orgId?: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`t.id = ${id}`, sql`t.deleted_at IS NULL`];
    if (orgId !== null && orgId !== undefined) {
      conditions.push(sql`t.organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    // `t.*` keeps every trip column (internal callers rely on it); the extra
    // LEFT JOIN labels let the admin show real names instead of raw UUIDs.
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            t.*,
            m.registration_plate  AS truck_plate,
            m.internal_code       AS truck_code,
            u.full_name           AS driver_name,
            lm.registration_plate AS loader_plate,
            lm.internal_code      AS loader_code,
            lo.full_name          AS loader_operator_name,
            p.name                AS source_parcel_name,
            p.code                AS source_parcel_code,
            p.municipality        AS source_parcel_municipality,
            f.name                AS source_farm_name,
            sd.name               AS source_depot_name,
            EXISTS(
              SELECT 1 FROM users du
              WHERE du.assigned_delivery_destination_id = t.destination_id
                AND du.organization_id = t.organization_id
                AND du.role = 'depot_manager'::user_role
                AND du.deleted_at IS NULL
            )                     AS destination_has_operator
          FROM trips t
          LEFT JOIN machines m  ON m.id  = t.truck_id
          LEFT JOIN users    u  ON u.id  = t.driver_id
          LEFT JOIN machines lm ON lm.id = t.loader_id
          LEFT JOIN users    lo ON lo.id = t.loader_operator_id
          LEFT JOIN parcels  p  ON p.id  = t.source_parcel_id
          LEFT JOIN farms    f  ON f.id  = p.farm_id
          LEFT JOIN delivery_destinations sd ON sd.id = t.source_depot_id
          WHERE ${where}
          LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`Trip ${id} not found`);
    }
    return rows[0];
  }

  async create(orgId: string | null, dto: TripCreateDto) {
    if (orgId !== null) {
      const truckCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines WHERE id = ${dto.truckId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `)) as unknown as { id: string }[];
      if (!truckCheck.length) throw new ForbiddenException('Truck not found in your organization');

      const driverCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users WHERE id = ${dto.driverId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `)) as unknown as { id: string }[];
      if (!driverCheck.length)
        throw new ForbiddenException('Driver not found in your organization');

      if (dto.loaderId) {
        const loaderCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines WHERE id = ${dto.loaderId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!loaderCheck.length)
          throw new ForbiddenException('Loader not found in your organization');
      }

      if (dto.loaderOperatorId) {
        const loaderOpCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users WHERE id = ${dto.loaderOperatorId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!loaderOpCheck.length)
          throw new ForbiddenException('Loader operator not found in your organization');
      }

      if (dto.sourceParcelId) {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels WHERE id = ${dto.sourceParcelId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new ForbiddenException('Parcel not found in your organization');
      }
    }

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      const tripNumber = await this.generateTripNumber(orgId, tx);
      return tx.execute(
        sql`INSERT INTO trips (
          organization_id,
          trip_number, status, source_parcel_id, truck_id, driver_id,
          loader_id, loader_operator_id, destination_name,
          destination_address, destination_coords,
          bale_count, source_parcel_auto
        ) VALUES (
          ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
          ${tripNumber}, ${TripStatus.planned}, ${dto.sourceParcelId},
          ${dto.truckId}, ${dto.driverId},
          ${dto.loaderId ?? null}, ${dto.loaderOperatorId ?? null},
          ${dto.destinationName ?? null}, ${dto.destinationAddress ?? null},
          ${dto.destinationCoords ? JSON.stringify(dto.destinationCoords) : null},
          0, false
        ) RETURNING *`,
      );
    });
    const created = (result as unknown as Record<string, unknown>[])[0];
    this.logTripFlow(String(created?.id ?? 'unknown'), 'CREATE', 'new', TripStatus.planned);
    return result;
  }

  private async generateTripNumber(
    orgId: string | null,
    executor: Pick<DrizzleProvider['db'], 'execute'>,
  ): Promise<string> {
    const dateStr = todayInRomania().replace(/-/g, '');
    const prefix = `TR-${dateStr}-`;
    // Serialize trip-number minting per org+day: two concurrent requests must
    // not read the same COUNT and emit a duplicate trip_number. The lock is
    // transaction-scoped and held until the caller commits the INSERT, so the
    // caller MUST run this inside a transaction.
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${prefix + (orgId ?? '')}))`);
    const conditions: ReturnType<typeof sql>[] = [sql`trip_number LIKE ${prefix + '%'}`];
    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    } else {
      conditions.push(sql`organization_id IS NULL`);
    }
    const where = sql.join(conditions, sql` AND `);
    const result = await executor.execute(
      sql`SELECT COUNT(*)::int as count FROM trips WHERE ${where}`,
    );
    const rows = result as unknown as { count: number }[];
    const count = (rows[0]?.count ?? 0) + 1;
    const seq = String(count).padStart(3, '0');
    return `${prefix}${seq}`;
  }

  private validateTransition(currentStatus: TripStatus, event: string): void {
    const available = getAvailableTransitions(currentStatus);
    if (!available.includes(event)) {
      throw new BadRequestException(
        `Transition '${event}' is not allowed from status '${currentStatus}'. Available: ${available.join(', ')}`,
      );
    }
  }

  async startLoading(id: string, orgId: string | null, dto: StartLoadingDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'START_LOADING');

    // The PATCH/transition path must validate org membership of the loader
    // pointers just like create() does — otherwise an operator can stamp a
    // foreign-org user/machine onto the trip via start-loading.
    if (orgId !== null) {
      if (dto.loaderOperatorId) {
        const opCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users WHERE id = ${dto.loaderOperatorId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!opCheck.length)
          throw new ForbiddenException('Loader operator not found in your organization');
      }
      if (dto.loaderId) {
        const loaderCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines WHERE id = ${dto.loaderId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!loaderCheck.length)
          throw new ForbiddenException('Loader not found in your organization');
      }
    }

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.loading},
        loader_operator_id = ${dto.loaderOperatorId},
        loader_id = ${dto.loaderId ?? (trip.loader_id as string | null)},
        loading_started_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'START_LOADING', from, TripStatus.loading);
    void this.pushToDriver(
      id,
      'Începe încărcarea',
      'Loaderul a început încărcarea camionului.',
      'assignment_created',
    );
    const parcelId = trip.source_parcel_id as string | null;
    if (parcelId) {
      try {
        await this.parcelsService.advanceHarvestOnLoadEvent(parcelId, 'loading_started', orgId);
      } catch (err) {
        this.winston.warn('startLoading: advanceHarvestOnLoadEvent failed', {
          context: 'TripsService',
          tripId: id,
          parcelId,
          err: err instanceof Error ? { message: err.message } : err,
        });
      }
    }
    return result;
  }

  async completeLoading(id: string, orgId: string | null, _dto: CompleteLoadingDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'COMPLETE_LOADING');

    const baleResult = await this.drizzleProvider.db.execute(
      sql`SELECT COALESCE(SUM(bale_count), 0)::int as total FROM bale_loads
          WHERE trip_id = ${id} AND deleted_at IS NULL
          ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}`,
    );
    const baleRows = baleResult as unknown as { total: number }[];
    const totalBales = baleRows[0]?.total ?? 0;

    if (totalBales === 0) {
      throw new BadRequestException('Cannot complete loading without any bale loads recorded');
    }

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.loaded},
        loading_completed_at = NOW(),
        bale_count = ${totalBales},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'COMPLETE_LOADING', from, TripStatus.loaded);
    void this.pushToDriver(
      id,
      'Transport pregătit',
      'Baloții au fost încărcați. Poți pleca.',
      'trip_loaded',
    );
    return result;
  }

  /**
   * Atomic loader flow ("Camion plin" handler).
   *
   * In one DB transaction:
   *   1. Find or create a Trip for (truckId, today) in status planned/loading.
   *   2. Insert a `bale_loads` row tied to that trip.
   *   3. Transition the trip directly to `loaded` (collapses the
   *      planned → loading → loaded chain because one full truckload from
   *      one parcel is one trip in this product flow).
   *   4. Mirror the result to `sync_idempotency` so retries are no-ops.
   *
   * Destination resolution order when creating a new trip:
   *   a) Truck's planned task today (`task_assignments.destination_id`)
   *   b) Global default destination (`delivery_destinations.is_default = TRUE`)
   *   c) NULL (driver picks before "Plecare")
   */
  async registerLoad(
    dto: RegisterLoadInput,
    callerId: string,
    orgId: string | null,
  ): Promise<RegisterLoadResult> {
    if (orgId !== null) {
      const truckCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines WHERE id = ${dto.truckId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `)) as unknown as { id: string }[];
      if (!truckCheck.length) throw new ForbiddenException('Truck not found in your organization');

      const loaderCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines WHERE id = ${dto.loaderMachineId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `)) as unknown as { id: string }[];
      if (!loaderCheck.length)
        throw new ForbiddenException('Loader not found in your organization');

      if (dto.sourceDepotId) {
        // Depot-sourced load: verify the depot exists in the caller's org.
        const depotCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM delivery_destinations WHERE id = ${dto.sourceDepotId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!depotCheck.length)
          throw new ForbiddenException('Depot not found in your organization');
      } else {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels WHERE id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new ForbiddenException('Parcel not found in your organization');
      }
    }

    // Auxiliary (one-time external) trucks take a collapsed path: no date filter,
    // no driver lookup, status → completed, + driver sign-link SMS.
    const auxRows = (await this.drizzleProvider.db.execute(
      sql`SELECT is_auxiliary FROM machines WHERE id = ${dto.truckId}::uuid LIMIT 1`,
    )) as unknown as { is_auxiliary: boolean }[];
    if (auxRows[0]?.is_auxiliary) {
      return this.registerAuxiliaryLoad(dto, callerId, orgId);
    }

    const idempotencyTable = 'register_load';

    const existing = (await this.drizzleProvider.db.execute(
      sql`SELECT result_data FROM sync_idempotency
          WHERE client_id = ${callerId}
            AND table_name = ${idempotencyTable}
            AND record_id = ${dto.idempotencyKey}
          LIMIT 1`,
    )) as unknown as { result_data: RegisterLoadResult | null }[];
    if (existing[0]?.result_data) {
      return existing[0].result_data;
    }

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      // Find an open trip for this truck today (FOR UPDATE to serialize
      // concurrent loader scans of the same truck).
      const openRows = (await tx.execute(
        sql`SELECT id, status, source_parcel_id
            FROM trips
            WHERE truck_id = ${dto.truckId}
              AND deleted_at IS NULL
              AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
              AND created_at::date = CURRENT_DATE
              ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE`,
      )) as unknown as { id: string; status: TripStatus; source_parcel_id: string | null }[];

      let tripId: string;
      let created = false;
      let fromStatus: TripStatus = TripStatus.planned;

      if (openRows[0]) {
        tripId = openRows[0].id;
        fromStatus = openRows[0].status;
      } else {
        // Resolve driver from truck's permanent assignment.
        const driverRows = (await tx.execute(
          sql`SELECT id FROM users
              WHERE assigned_machine_id = ${dto.truckId}
                AND role = 'driver'::user_role
                AND deleted_at IS NULL
              ORDER BY created_at ASC
              LIMIT 1`,
        )) as unknown as { id: string }[];
        const driverId = driverRows[0]?.id;
        if (!driverId) {
          throw new BadRequestException('Camionul nu are șofer asignat. Contactează dispecerul.');
        }

        // Resolve destination: truck's planned task today → global default → null.
        let destinationId: string | null = null;
        let destName: string | null = null;
        let destAddress: string | null = null;
        let destCoordsGeoJson: string | null = null;

        const taskDestRows = (await tx.execute(
          sql`SELECT dd.id, dd.name, dd.address,
                     ST_AsGeoJSON(dd.coords) AS coords_geojson
              FROM task_assignments ta
              JOIN delivery_destinations dd ON dd.id = ta.destination_id
              WHERE ta.machine_id = ${dto.truckId}
                AND ta.assignment_date = CURRENT_DATE
                AND ta.deleted_at IS NULL
                AND ta.destination_id IS NOT NULL
                AND dd.deleted_at IS NULL
              ORDER BY ta.sequence_order ASC
              LIMIT 1`,
        )) as unknown as {
          id: string;
          name: string;
          address: string | null;
          coords_geojson: string | null;
        }[];

        if (taskDestRows[0]) {
          destinationId = taskDestRows[0].id;
          destName = taskDestRows[0].name;
          destAddress = taskDestRows[0].address;
          destCoordsGeoJson = taskDestRows[0].coords_geojson;
        } else {
          const defaultDest = await this.deliveryDestinationsService.findDefault(orgId);
          if (defaultDest) {
            const defRows = (await tx.execute(
              sql`SELECT name, address, ST_AsGeoJSON(coords) AS coords_geojson
                  FROM delivery_destinations
                  WHERE id = ${defaultDest.id}
                  LIMIT 1`,
            )) as unknown as {
              name: string;
              address: string | null;
              coords_geojson: string | null;
            }[];
            if (defRows[0]) {
              destinationId = defaultDest.id;
              destName = defRows[0].name;
              destAddress = defRows[0].address;
              destCoordsGeoJson = defRows[0].coords_geojson;
            }
          }
        }

        const tripNumber = await this.generateTripNumber(orgId, tx);
        const insertedTrip = (await tx.execute(
          sql`INSERT INTO trips (
                organization_id,
                trip_number, status,
                source_parcel_id, source_depot_id, source_parcel_auto,
                truck_id, driver_id,
                loader_id, loader_operator_id,
                destination_name, destination_address, destination_coords,
                bale_count
              ) VALUES (
                ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
                ${tripNumber}, ${TripStatus.planned}::trip_status,
                ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId}`},
                ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
                ${dto.sourceDepotId ? sql`false` : sql`true`},
                ${dto.truckId}, ${driverId},
                ${dto.loaderMachineId}, ${callerId},
                ${destName}, ${destAddress},
                ${destCoordsGeoJson ? sql`ST_GeomFromGeoJSON(${destCoordsGeoJson})` : sql`NULL`},
                0
              )
              RETURNING id`,
        )) as unknown as { id: string }[];

        tripId = insertedTrip[0].id;
        created = true;

        if (destinationId) {
          // Best-effort link the truck's task today to this auto-created trip.
          await tx.execute(
            sql`UPDATE task_assignments SET trip_id = ${tripId}, updated_at = NOW()
                WHERE machine_id = ${dto.truckId}
                  AND assignment_date = CURRENT_DATE
                  AND deleted_at IS NULL
                  AND trip_id IS NULL`,
          );
        }

        this.logTripFlow(tripId, 'AUTO_CREATE_FROM_LOAD', 'new', TripStatus.planned);
      }

      // registerLoad collapses planned|loading → loaded — validate the jump
      // against the state machine instead of trusting the UPDATE's WHERE alone.
      this.validateTransition(fromStatus, 'REGISTER_LOAD');

      // Business rules (gate behind STRAWBOSS_BALE_VALIDATION_ENABLED for fast rollback):
      //  A. Cannot load more bales than remain unloaded on the parcel.
      //  B. Cannot load more bales than the truck's capacity (per-truck override on
      //     machines.max_bale_count, falling back to DEFAULT_MAX_BALES_PER_TRUCK = 33).
      // Both checks run inside the same `tx` as the bale_loads INSERT so concurrent
      // loaders racing on the same parcel/truck cannot both pass.
      if (process.env.STRAWBOSS_BALE_VALIDATION_ENABLED !== 'false') {
        // Parcel-availability guard (A): only meaningful for parcel loads. A depot
        // has no per-parcel `bale_productions`, so skip it entirely for depot loads
        // (depot-inventory reconciliation is a future enhancement). The truck-capacity
        // guard (B) below still applies to both parcel and depot loads.
        if (!dto.sourceDepotId) {
          const availabilityRows = (await tx.execute(
            sql`SELECT
                  COALESCE((SELECT SUM(bale_count) FROM bale_productions
                            WHERE parcel_id = ${dto.parcelId}
                              AND deleted_at IS NULL
                              ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS produced,
                  COALESCE((SELECT SUM(bale_count) FROM bale_loads
                            WHERE parcel_id = ${dto.parcelId}
                              AND deleted_at IS NULL
                              ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS loaded`,
          )) as unknown as { produced: number; loaded: number }[];
          const produced = Number(availabilityRows[0]?.produced ?? 0);
          const loaded = Number(availabilityRows[0]?.loaded ?? 0);
          const remaining = produced - loaded;

          if (remaining <= 0) {
            throw new BadRequestException({
              error: 'parcel_fully_loaded',
              message: 'Pe parcela aceasta toți baloții au fost deja încărcați.',
              produced,
              loaded,
              remaining,
            });
          }
          if (dto.baleCount > remaining) {
            throw new BadRequestException({
              error: 'bale_count_exceeds_remaining',
              message: `Pe parcelă au mai rămas ${remaining} baloți disponibili.`,
              produced,
              loaded,
              remaining,
            });
          }
        }

        const truckCapRows = (await tx.execute(
          sql`SELECT max_bale_count FROM machines
               WHERE id = ${dto.truckId}::uuid AND deleted_at IS NULL
               LIMIT 1`,
        )) as unknown as { max_bale_count: number | null }[];
        const truckCap = truckCapRows[0]?.max_bale_count ?? DEFAULT_MAX_BALES_PER_TRUCK;

        if (dto.baleCount > truckCap) {
          throw new BadRequestException({
            error: 'bale_count_exceeds_truck_capacity',
            message: `Camionul are capacitatea maximă ${truckCap} baloți.`,
            truckCap,
          });
        }
      }

      // Insert the bale_load tied to this trip.
      await tx.execute(
        sql`INSERT INTO bale_loads (
              organization_id,
              id, trip_id, parcel_id, source_depot_id, loader_id, operator_id,
              bale_count, loaded_at, gps_lat, gps_lon
            ) VALUES (
              ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
              ${dto.idempotencyKey}, ${tripId},
              ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId}`},
              ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
              ${dto.loaderMachineId}, ${callerId},
              ${dto.baleCount}, NOW(),
              ${dto.gpsLat ?? null}, ${dto.gpsLon ?? null}
            )`,
      );

      // Transition trip → loaded (collapses planned → loading → loaded so
      // the driver immediately sees a "ready to depart" trip).
      const updated = (await tx.execute(
        sql`UPDATE trips SET
              status = ${TripStatus.loaded}::trip_status,
              loading_started_at = COALESCE(loading_started_at, NOW()),
              loading_completed_at = NOW(),
              loader_signature_url = ${dto.loaderSignature ?? null},
              bale_count = (
                SELECT COALESCE(SUM(bale_count), 0)::int
                FROM bale_loads
                WHERE trip_id = ${tripId} AND deleted_at IS NULL
                  ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
              ),
              updated_at = NOW()
            WHERE id = ${tripId}
              AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
            RETURNING *`,
      )) as unknown as Record<string, unknown>[];

      if (!updated.length) {
        throw new BadRequestException(
          'Trip status changed concurrently — nu se poate închide încărcarea.',
        );
      }

      const payload: RegisterLoadResult = {
        trip: updated[0],
        baleLoadId: dto.idempotencyKey,
        created,
      };

      // Idempotency record so retries return the same payload immediately.
      await tx.execute(
        sql`INSERT INTO sync_idempotency (
              client_id, table_name, record_id,
              client_version, server_version, result_data
            ) VALUES (
              ${callerId}, ${idempotencyTable}, ${dto.idempotencyKey},
              1, 1, ${JSON.stringify(payload)}::jsonb
            )
            ON CONFLICT DO NOTHING`,
      );

      return payload;
    });

    this.logTripFlow(
      result.trip.id as string,
      'REGISTER_LOAD',
      result.created ? 'new' : (result.trip.status as string),
      TripStatus.loaded,
    );
    void this.pushToDriver(
      result.trip.id as string,
      'Transport pregătit',
      'Baloții au fost încărcați. Poți pleca.',
      'trip_loaded',
    );

    // Harvest-rank advancement is parcel-scoped; depot loads have no parcel to
    // advance, so this only runs for parcel-sourced loads.
    if (dto.parcelId) {
      try {
        const remaining = await this.computeRemainingBalesOnParcel(dto.parcelId, orgId);
        if (remaining <= 0) {
          await this.parcelsService.advanceHarvestOnLoadEvent(dto.parcelId, 'all_loaded', orgId);
        }
      } catch (err) {
        this.winston.warn('registerLoad: advanceHarvestOnLoadEvent failed', {
          context: 'TripsService',
          tripId: result.trip.id as string,
          parcelId: dto.parcelId,
          err: err instanceof Error ? { message: err.message } : err,
        });
      }
    }
    return result;
  }

  /**
   * Loader registers a load onto an AUXILIARY (one-time external) truck. The
   * external truck has no app driver and no depot step, so this single action
   * COLLAPSES the trip to `completed`: stage-1 CMR is queued here (an auxiliary
   * trip never calls depart()), a one-time public sign token is minted, and the
   * external driver is SMS'd a sign-and-leave link. The driver's later signature
   * (via signByPublicToken) finalizes stage-2 of the document.
   */
  private async registerAuxiliaryLoad(
    dto: RegisterLoadInput,
    callerId: string,
    orgId: string | null,
  ): Promise<RegisterLoadResult> {
    const idempotencyTable = 'register_load';
    const existing = (await this.drizzleProvider.db.execute(
      sql`SELECT result_data FROM sync_idempotency
          WHERE client_id = ${callerId}
            AND table_name = ${idempotencyTable}
            AND record_id = ${dto.idempotencyKey}
          LIMIT 1`,
    )) as unknown as { result_data: RegisterLoadResult | null }[];
    if (existing[0]?.result_data) {
      return existing[0].result_data;
    }

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      // The auxiliary trip is created up-front by autoUpsertAuxiliaryTrip when the
      // admin assigns a loader — there is no date filter (the external truck may
      // arrive any day) and we never auto-create here.
      const openRows = (await tx.execute(
        sql`SELECT id, status
            FROM trips
            WHERE truck_id = ${dto.truckId}
              AND is_auxiliary = true
              AND deleted_at IS NULL
              AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
              ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE`,
      )) as unknown as {
        id: string;
        status: TripStatus;
      }[];

      if (!openRows[0]) {
        throw new BadRequestException(
          'Camionul auxiliar nu are o cursă activă. Dispecerul trebuie să asigneze un loader.',
        );
      }
      const tripId = openRows[0].id;
      const fromStatus = openRows[0].status;
      this.validateTransition(fromStatus, 'REGISTER_LOAD');

      await tx.execute(
        // A load is EITHER parcel-sourced (loader at a field) OR depot-sourced
        // (loader assigned to a depot). bale_loads enforces
        // CHECK (parcel_id IS NOT NULL OR source_depot_id IS NOT NULL), so exactly
        // one must be set — mirrors the normal register-load path above.
        sql`INSERT INTO bale_loads (
              organization_id,
              id, trip_id, parcel_id, source_depot_id, loader_id, operator_id,
              bale_count, loaded_at, gps_lat, gps_lon
            ) VALUES (
              ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
              ${dto.idempotencyKey}, ${tripId},
              ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId ?? null}`},
              ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
              ${dto.loaderMachineId}, ${callerId},
              ${dto.baleCount}, NOW(),
              ${dto.gpsLat ?? null}, ${dto.gpsLon ?? null}
            )`,
      );

      // Aux lifecycle: planned → loaded → completed. The loader finishing the
      // load lands the trip on `loaded` (same as a normal trip); a delayed job
      // auto-completes it a few minutes later. The sign-token, stage-1 CMR,
      // driver SMS and truck retirement happen in applyAuxiliaryLoadedSideEffects
      // after commit (shared with the admin force-load path).
      const updated = (await tx.execute(
        sql`UPDATE trips SET
              status = ${TripStatus.loaded}::trip_status,
              loading_started_at = COALESCE(loading_started_at, NOW()),
              loading_completed_at = NOW(),
              loader_signature_url = ${dto.loaderSignature ?? null},
              loader_id = ${dto.loaderMachineId},
              loader_operator_id = COALESCE(loader_operator_id, ${callerId}),
              -- record the actual pickup source (the loader's field OR depot) if
              -- the trip was created without one (aux trucks aren't tied to a
              -- fixed parcel; a depot-assigned loader sources from the depot).
              source_parcel_id = COALESCE(
                source_parcel_id,
                ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId ?? null}`}
              ),
              source_depot_id = COALESCE(
                source_depot_id,
                ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`}
              ),
              bale_count = (
                SELECT COALESCE(SUM(bale_count), 0)::int
                FROM bale_loads
                WHERE trip_id = ${tripId} AND deleted_at IS NULL
                  ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
              ),
              updated_at = NOW()
            WHERE id = ${tripId}
              AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
            RETURNING *`,
      )) as unknown as Record<string, unknown>[];

      if (!updated.length) {
        throw new BadRequestException(
          'Trip status changed concurrently — nu se poate închide încărcarea.',
        );
      }

      const payload: RegisterLoadResult = {
        trip: updated[0],
        baleLoadId: dto.idempotencyKey,
        created: false,
      };

      await tx.execute(
        sql`INSERT INTO sync_idempotency (
              client_id, table_name, record_id,
              client_version, server_version, result_data
            ) VALUES (
              ${callerId}, ${idempotencyTable}, ${dto.idempotencyKey},
              1, 1, ${JSON.stringify(payload)}::jsonb
            )
            ON CONFLICT DO NOTHING`,
      );

      return payload;
    });

    const trip = result.trip;
    const tripId = trip.id as string;
    this.logTripFlow(tripId, 'REGISTER_LOAD_AUX', 'planned', TripStatus.loaded);

    // Schedule the delayed auto-complete (loaded → completed after ~5 min), then
    // fire the loaded side-effects (sign-token + stage-1 CMR + driver SMS + retire
    // the one-time truck). Both are idempotent and shared with the admin
    // force-load path; the auto-complete job also re-runs the side-effects as a
    // crash backstop.
    await this.scheduleAuxiliaryAutoComplete(tripId, orgId);
    await this.applyAuxiliaryLoadedSideEffects(tripId, orgId);

    return result;
  }

  /**
   * Idempotent side-effects fired when an auxiliary trip enters `loaded` (from a
   * mobile register-load OR an admin force-status). Gated on atomically claiming
   * `public_sign_token`, so it runs EXACTLY ONCE even if called from several
   * paths: mints the driver sign-token, retires the one-time aux truck (soft
   * delete — it drops out of the fleet list but stays readable for CMR + trip
   * history), queues the stage-1 (loading) CMR, and SMSs the external driver the
   * sign-and-leave link. All best-effort — failures are logged, never thrown.
   */
  private async applyAuxiliaryLoadedSideEffects(
    tripId: string,
    orgId: string | null,
  ): Promise<void> {
    const token = randomUUID();
    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    // Atomic claim: only the first caller (token still null) proceeds; a second
    // caller (redundant admin force, or the auto-complete backstop) gets 0 rows.
    const claimed = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET public_sign_token = ${token}, updated_at = NOW()
          WHERE id = ${tripId}
            AND is_auxiliary = true
            AND public_sign_token IS NULL${orgFilter}
          RETURNING truck_id, external_driver_phone, organization_id, bale_count`,
    )) as unknown as {
      truck_id: string | null;
      external_driver_phone: string | null;
      organization_id: string | null;
      bale_count: number | null;
    }[];
    if (!claimed.length) return; // side-effects already ran for this trip

    const row = claimed[0];

    if (row.truck_id) {
      await this.drizzleProvider.db
        .execute(
          sql`UPDATE machines
              SET deleted_at = NOW(), updated_at = NOW()
              WHERE id = ${row.truck_id}::uuid
                AND is_auxiliary = true
                AND deleted_at IS NULL`,
        )
        .catch((err) =>
          this.winston.warn('applyAuxiliaryLoadedSideEffects: retire truck failed', {
            context: 'TripsService',
            tripId,
            err: err instanceof Error ? { message: err.message } : err,
          }),
        );
    }

    // Stage-1 CMR (loading part) — auxiliary trips never depart(), so queue here.
    await this.cmrQueue.add('generate', { tripId, orgId, stage: 1 }).catch((err) =>
      this.winston.warn('applyAuxiliaryLoadedSideEffects: CMR enqueue failed', {
        context: 'TripsService',
        tripId,
        err: err instanceof Error ? { message: err.message } : err,
      }),
    );

    // SMS the external driver a one-time sign-and-leave link (stubbed).
    const driverPhone = row.external_driver_phone;
    if (driverPhone) {
      const slug = await this.resolveOrgSlug(row.organization_id);
      const signUrl = slug
        ? `${this.publicWebBaseUrl()}/${slug}/sign/${token}`
        : `${this.publicWebBaseUrl()}/sign/${token}`;
      const tpl = messageTemplates[MessageKind.driver_loaded_sign_link]({
        signUrl,
        baleCount: Number(row.bale_count ?? 0),
      });
      void this.messaging
        .sendSms({
          to: driverPhone,
          body: tpl.body,
          kind: MessageKind.driver_loaded_sign_link,
          metadata: { tripId },
        })
        .catch((err) =>
          this.winston.warn('applyAuxiliaryLoadedSideEffects: sign-link SMS failed', {
            context: 'TripsService',
            tripId,
            err: err instanceof Error ? { message: err.message } : err,
          }),
        );
    }
  }

  /**
   * Enqueue (or replace) the delayed job that auto-completes an auxiliary trip
   * `loaded → completed`. Deterministic jobId → a repeat schedule dedupes rather
   * than piling up. Non-fatal: a Redis hiccup is logged, not thrown (the load
   * already committed).
   */
  private async scheduleAuxiliaryAutoComplete(tripId: string, orgId: string | null): Promise<void> {
    await this.tripAutocompleteQueue
      .add(
        'complete',
        { tripId, orgId },
        { delay: AUX_AUTOCOMPLETE_DELAY_MS, jobId: `aux-autocomplete-${tripId}` },
      )
      .catch((err) =>
        this.winston.error('scheduleAuxiliaryAutoComplete: enqueue failed', {
          context: 'TripsService',
          tripId,
          err: err instanceof Error ? { message: err.message } : err,
        }),
      );
  }

  /**
   * Delayed-job target: flip an auxiliary trip `loaded → completed` a few minutes
   * after it was loaded. Idempotent — a no-op if the trip already left `loaded`
   * (an admin completed or cancelled it early). Also re-runs the loaded
   * side-effects first as a backstop, in case they never fired at load time
   * (e.g. a crash right after the load committed).
   */
  async autoCompleteAuxiliary(tripId: string, orgId: string | null): Promise<void> {
    await this.applyAuxiliaryLoadedSideEffects(tripId, orgId);

    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            status = ${TripStatus.completed}::trip_status,
            completed_at = COALESCE(completed_at, NOW()),
            updated_at = NOW()
          WHERE id = ${tripId}
            AND is_auxiliary = true
            AND status = ${TripStatus.loaded}::trip_status${orgFilter}
          RETURNING id`,
    )) as unknown as { id: string }[];
    if (!updated.length) {
      this.winston.log('flow', 'Aux auto-complete: no-op (trip not in loaded)', {
        context: 'TripsService',
        tripId,
      });
      return;
    }
    this.logTripFlow(tripId, 'AUTO_COMPLETE_AUX', TripStatus.loaded, TripStatus.completed);
  }

  /** Org slug for building public driver links; null if not resolvable. */
  private async resolveOrgSlug(orgId: string | null): Promise<string | null> {
    if (!orgId) return null;
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT slug FROM organizations WHERE id = ${orgId}::uuid LIMIT 1`,
    )) as unknown as { slug: string }[];
    return rows[0]?.slug ?? null;
  }

  /**
   * Open auxiliary trips currently assigned to a loader machine — independent
   * of GPS distance (the external truck has no device, so it never appears in
   * the trucks-at-loader proximity query). Drives the mobile loader's AUX
   * cards. Scoped to `dateFrom` (same day boundary the "Încărcări" tab uses
   * via `useMyTrucksToLoad`'s `dateFrom=startOfDayRomaniaISO()`) so a trip
   * whose task was left open across days — or that stalled in `loading` and
   * was never picked up — doesn't linger on the tab forever.
   */
  async listAuxiliaryForLoader(loaderMachineId: string, orgId: string | null, dateFrom?: string) {
    const rows = await this.drizzleProvider.db.execute(
      sql`SELECT
            t.id, t.trip_number AS "tripNumber", t.status,
            t.bale_count AS "baleCount",
            t.source_parcel_id AS "sourceParcelId",
            t.source_depot_id AS "sourceDepotId",
            t.external_driver_name AS "externalDriverName",
            t.external_driver_phone AS "externalDriverPhone",
            t.destination_name AS "destinationName",
            m.id AS "truckId",
            m.registration_plate AS "truckPlate", m.internal_code AS "truckCode",
            p.name AS "sourceParcelName", p.code AS "sourceParcelCode",
            p.municipality AS "sourceParcelMunicipality",
            tr.crop_type AS "cropType",
            tr.quality AS "quality"
          FROM trips t
          JOIN machines m ON m.id = t.truck_id
          LEFT JOIN parcels p ON p.id = t.source_parcel_id
          LEFT JOIN trip_requests tr ON tr.id = t.trip_request_id
          WHERE t.is_auxiliary = true
            AND t.loader_id = ${loaderMachineId}::uuid
            AND t.deleted_at IS NULL
            AND t.status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
            ${orgId ? sql`AND t.organization_id = ${orgId}::uuid` : sql``}
            ${dateFrom ? sql`AND t.created_at >= ${dateFrom}` : sql``}
          ORDER BY t.created_at ASC`,
    );
    return rows as unknown as Record<string, unknown>[];
  }

  async depart(id: string, orgId: string | null, dto: DepartDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'DEPART');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.in_transit},
        driver_signature_url = ${dto.driverSignature},
        departure_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'DEPART', from, TripStatus.in_transit);
    void this.pushToDriver(
      id,
      'Drum bun',
      `Cursa este în drum spre ${(trip.destination_name as string | null) ?? 'destinație'}.`,
      'trip_departed',
    );

    // CMR stage 1 — partial document with loader + driver signatures
    await this.cmrQueue.add('generate', { tripId: id, orgId: orgId, stage: 1 });
    this.winston.log('flow', `CMR stage-1 generation queued for trip ${id}`, {
      context: 'TripsService',
      tripId: id,
    });

    return result;
  }

  async arrive(id: string, orgId: string | null, _dto: ArriveDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'ARRIVE');

    // Trip distance comes from the GPS track of the truck between depart and
    // now (arrival), summed pairwise with ST_DistanceSphere — same approach as
    // location.service.getKmByDay. NULL/zero-ping cases COALESCE to 0. The
    // hourly reconciliation job recomputes this for recently-arrived trips to
    // pick up pings that synced late from the phone.
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips AS t SET
        status = ${TripStatus.arrived},
        arrival_at = NOW(),
        gps_distance_km = (
          SELECT ROUND((COALESCE(SUM(
            -- Drop GPS noise: legs implying > 130 km/h (36 m/s) or > 5 km in a
            -- single segment. Mirrors reports.service.ts so arrive() and the
            -- reports never disagree on a trip's distance.
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
                AND recorded_at <= NOW()
            ) pts
            WINDOW w AS (ORDER BY recorded_at)
          ) pairwise
        ),
        updated_at = NOW()
      WHERE t.id = ${id} AND t.status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'ARRIVE', from, TripStatus.arrived);
    void this.pushToDriver(
      id,
      'Ai ajuns la destinație',
      'Confirmă livrarea când ești gata.',
      'trip_arrived',
    );
    return result;
  }

  async startDelivery(id: string, orgId: string | null, dto: StartDeliveryDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'START_DELIVERY');

    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${TripStatus.delivering}`,
      sql`updated_at = NOW()`,
    ];

    if (dto.destinationName) {
      setClauses.push(sql`destination_name = ${dto.destinationName}`);
    }

    const setClause = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET ${setClause} WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'START_DELIVERY', from, TripStatus.delivering);
    return result;
  }

  async confirmDelivery(id: string, orgId: string | null, dto: ConfirmDeliveryDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'CONFIRM_DELIVERY');

    // The driver weighs the loaded truck (gross) and the empty truck (tare) at
    // the depot; net_weight_kg is the generated column gross - tare, guarded by
    // chk_net_weight_sane (gross >= tare). The mobile validates gross >= tare
    // before submit. Reject (not silently clamp) a swapped/typo'd payload — a
    // clamp would write net=0 to a legally binding CMR without any error.
    const grossWeightKg = dto.grossWeightKg;
    if (dto.tareWeightKg > grossWeightKg) {
      throw new BadRequestException({
        error: 'tare_exceeds_gross',
        message: 'Tara nu poate depăși greutatea brută.',
        grossWeightKg,
        tareWeightKg: dto.tareWeightKg,
      });
    }
    const tareWeightKg = dto.tareWeightKg;

    // M8 — delivered_bale_count (distinct from the loaded bale_count) so
    // reconciliation can see damage/loss on this non-depot path: the depot
    // path already overwrites bale_count itself with the operator-confirmed
    // count (confirmDepotDelivery, see 00053), but this path never touches
    // bale_count, so without a separate column deliveredVsLoadedDiff was
    // always 0 even when bales were deteriorated in transit.
    const loadedBaleCount = Number(trip.bale_count ?? 0);
    const deterioratedCount = dto.deterioratedBalesCount ?? 0;
    const deliveredBaleCount = Math.max(loadedBaleCount - deterioratedCount, 0);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.delivered},
        gross_weight_kg = ${grossWeightKg},
        tare_weight_kg = ${tareWeightKg},
        weight_ticket_number = ${dto.weightTicketNumber ?? null},
        weight_ticket_photo_url = ${dto.weightTicketPhotoUrl ?? null},
        deteriorated_bales_count = ${dto.deterioratedBalesCount ?? null},
        delivered_bale_count = ${deliveredBaleCount},
        delivered_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'CONFIRM_DELIVERY', from, TripStatus.delivered);
    return result;
  }

  async complete(id: string, orgId: string | null, dto: CompleteDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'COMPLETE');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.completed},
        receiver_name = ${dto.receiverName},
        receiver_signature_url = ${dto.receiverSignature},
        receiver_signed_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'COMPLETE', from, TripStatus.completed);
    void this.pushToDriver(
      id,
      'Transport finalizat',
      'Transportul a fost completat cu succes.',
      'trip_completed',
    );

    // CMR stage 2 — regenerate/complete the document with receiver signature
    await this.cmrQueue.add('generate', { tripId: id, orgId: orgId, stage: 2 });
    this.winston.log('flow', `CMR generation queued for trip ${id}`, {
      context: 'TripsService',
      tripId: id,
    });

    // Plan C — multi-iteration hook (shared with confirmDepotDelivery).
    await this.runPostCompleteHooks(trip, orgId);

    return result;
  }

  /**
   * Post-complete side effects shared by `complete()` (driver/admin receiver
   * completion) and `confirmDepotDelivery()` (depot-operator confirmation).
   * Plan C multi-iteration: if the source parcel still has bales, prompt the
   * loader to recall the truck (idempotency-guarded by recall_decided_at); if it
   * is empty, advance the parcel harvest status via Plan B's helper. Best-effort —
   * never throws (a push/harvest failure must not fail the completed transition).
   *
   * `trip` is the pre-update findById row (carries source_parcel_id,
   * loader_operator_id, recall_decided_at, truck_code/plate enrichment).
   */
  private async runPostCompleteHooks(
    trip: Record<string, unknown>,
    orgId: string | null,
  ): Promise<void> {
    const id = trip.id as string;
    try {
      const sourceParcelId = trip.source_parcel_id as string | null;
      const loaderOperatorId = trip.loader_operator_id as string | null;
      // Structured idempotency guard: a non-null recall_decided_at means the
      // loader already answered for this trip (replaces fragile delivery_notes
      // marker parsing — see migration 00048).
      const alreadyAnswered = trip.recall_decided_at != null;
      if (sourceParcelId) {
        const remaining = await this.computeRemainingBalesOnParcel(sourceParcelId, orgId);
        if (remaining > 0 && loaderOperatorId) {
          // Suppress repeated prompts if the loader already answered for this trip.
          if (!alreadyAnswered) {
            const truckCode =
              (trip.truck_code as string | null) ?? (trip.truck_plate as string | null) ?? '—';
            void this.notificationsService.sendTruckUnloadedLoaderPrompt(
              loaderOperatorId,
              id,
              truckCode,
            );
          }
        } else if (remaining <= 0) {
          try {
            await this.parcelsService.advanceHarvestOnLoadEvent(
              sourceParcelId,
              'all_delivered',
              orgId,
            );
          } catch (err) {
            this.winston.warn('runPostCompleteHooks: advanceHarvestOnLoadEvent failed', {
              context: 'TripsService',
              tripId: id,
              parcelId: sourceParcelId,
              err: err instanceof Error ? { message: err.message } : err,
            });
          }
        }
      }
    } catch (err) {
      this.winston.warn('runPostCompleteHooks failed', {
        context: 'TripsService',
        tripId: id,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /**
   * Depot-operator delivery confirmation (driver → operator depozit). A
   * depot_manager assigned to the trip's destination depot confirms the arriving
   * bale count (+ gross/tare on a principal depot with a working scale; bale count
   * only on a temporary depot or when the scale is broken), signs with their
   * specimen, and this single action drives the trip arrived/delivering →
   * delivered → completed in one transaction (the operator's signature is stored
   * as the receiver signature). Server-enforced geofence: the truck's latest GPS
   * must be within the depot's confirm_radius_m. Idempotent on `idempotencyKey`.
   */
  async confirmDepotDelivery(
    id: string,
    user: { id: string; role: string; organizationId: string | null },
    dto: ConfirmDepotDeliveryDto,
  ) {
    const orgId = user.organizationId;
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;

    // Idempotency — a replay returns the cached completed trip rows.
    const idempotencyTable = 'confirm_depot_delivery';
    const existing = (await this.drizzleProvider.db.execute(
      sql`SELECT result_data FROM sync_idempotency
          WHERE client_id = ${user.id}
            AND table_name = ${idempotencyTable}
            AND record_id = ${dto.idempotencyKey}
          LIMIT 1`,
    )) as unknown as { result_data: unknown }[];
    if (existing[0]?.result_data) {
      return existing[0].result_data;
    }

    // Validate the transition up-front (after the idempotency replay check) so an
    // already-completed/cancelled trip returns a clear "invalid transition" error
    // instead of a misleading gps_stale/outside_geofence error from the checks below.
    this.validateTransition(from, 'CONFIRM_DELIVERY_AT_DEPOT');

    const destinationId = trip.destination_id as string | null;
    if (!destinationId) {
      throw new BadRequestException({
        error: 'no_destination',
        message: 'Cursa nu are un depozit de destinație.',
      });
    }

    // Authorization: a depot_manager may only confirm at their assigned depot
    // (admin bypasses). Mirrors deposit-inventory.ensureUserCanAccessDepot.
    if (user.role !== 'admin') {
      const userRows = (await this.drizzleProvider.db.execute(sql`
        SELECT assigned_delivery_destination_id AS "assignedId"
          FROM users
         WHERE id = ${user.id}::uuid AND deleted_at IS NULL
           ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
         LIMIT 1
      `)) as unknown as { assignedId: string | null }[];
      if ((userRows[0]?.assignedId ?? null) !== destinationId) {
        throw new ForbiddenException('You can only confirm deliveries at your assigned depot');
      }
    }

    // Depot type + geofence config.
    const depotRows = (await this.drizzleProvider.db.execute(sql`
      SELECT depot_type AS "depotType",
             confirm_radius_m AS "confirmRadiusM",
             (coords IS NOT NULL) AS "hasCoords",
             (boundary IS NOT NULL) AS "hasBoundary"
        FROM delivery_destinations
       WHERE id = ${destinationId}::uuid AND deleted_at IS NULL
       LIMIT 1
    `)) as unknown as {
      depotType: string;
      confirmRadiusM: number;
      hasCoords: boolean;
      hasBoundary: boolean;
    }[];
    const depot = depotRows[0];
    if (!depot) {
      throw new BadRequestException({
        error: 'depot_not_found',
        message: 'Depozitul nu a fost găsit.',
      });
    }

    // Weight rules. Principal depot with a working scale must carry gross; tare ≤
    // gross. Temporary depot or broken scale → weights stay NULL (net auto-NULL).
    const scaleBroken = dto.scaleBroken === true;
    let grossWeightKg: number | null = null;
    let tareWeightKg: number | null = null;
    if (depot.depotType === 'principal' && !scaleBroken) {
      if (typeof dto.grossWeightKg !== 'number' || dto.grossWeightKg <= 0) {
        throw new BadRequestException({
          error: 'gross_weight_required',
          message:
            'Depozitul principal necesită greutatea brută (sau marcați „Cântarul nu merge").',
        });
      }
      grossWeightKg = dto.grossWeightKg;
      tareWeightKg = typeof dto.tareWeightKg === 'number' ? dto.tareWeightKg : 0;
      if (tareWeightKg > grossWeightKg) {
        throw new BadRequestException({
          error: 'tare_exceeds_gross',
          message: 'Tara nu poate depăși greutatea brută.',
          grossWeightKg,
          tareWeightKg,
        });
      }
    }

    // Server-enforced geofence: the truck's latest GPS must be within the depot's
    // confirm radius of the boundary polygon (or the centroid coords when a
    // temporary depot has no polygon). No recent fix → reject (do not allow).
    if (!depot.hasCoords && !depot.hasBoundary) {
      throw new BadRequestException({
        error: 'depot_no_location',
        message: 'Depozitul nu are o locație definită; nu se poate verifica perimetrul.',
      });
    }
    const truckId = trip.truck_id as string | null;
    if (!truckId) {
      throw new BadRequestException({
        error: 'no_truck',
        message: 'Cursa nu are un camion asociat.',
      });
    }
    const geoRows = (await this.drizzleProvider.db.execute(sql`
      WITH ltp AS (
        SELECT coords, recorded_at
        FROM machine_location_events
        WHERE machine_id = ${truckId}::uuid
          AND recorded_at >= NOW() - INTERVAL '15 minutes'
        ORDER BY recorded_at DESC
        LIMIT 1
      )
      SELECT
        (ltp.recorded_at IS NOT NULL) AS "hasFix",
        CASE WHEN ltp.coords IS NOT NULL THEN
          ST_DWithin(ltp.coords::geography, COALESCE(dd.boundary, dd.coords)::geography, dd.confirm_radius_m)
          ELSE FALSE END AS "inside",
        CASE WHEN ltp.coords IS NOT NULL THEN
          ROUND(ST_Distance(ltp.coords::geography, COALESCE(dd.boundary, dd.coords)::geography)::numeric, 1)::float
          ELSE NULL END AS "distanceM"
      FROM delivery_destinations dd
      LEFT JOIN ltp ON TRUE
      WHERE dd.id = ${destinationId}::uuid
      LIMIT 1
    `)) as unknown as { hasFix: boolean; inside: boolean; distanceM: number | null }[];
    const geo = geoRows[0];
    if (!geo?.hasFix) {
      throw new BadRequestException({
        error: 'gps_stale',
        message: 'Camionul nu a transmis o poziție GPS recentă. Așteaptă o actualizare.',
      });
    }
    if (!geo.inside) {
      throw new BadRequestException({
        error: 'outside_geofence',
        message: 'Camionul nu este în perimetrul depozitului.',
        distanceM: geo.distanceM,
        radiusM: depot.confirmRadiusM,
      });
    }

    // The operator is the receiver — their name + signature fill the receiver
    // fields so the completed CMR is signed.
    const opRows = (await this.drizzleProvider.db.execute(
      sql`SELECT full_name FROM users WHERE id = ${user.id}::uuid LIMIT 1`,
    )) as unknown as { full_name: string | null }[];
    const operatorName = opRows[0]?.full_name ?? 'Operator depozit';

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      const updated = (await tx.execute(
        sql`UPDATE trips SET
          status = ${TripStatus.completed},
          bale_count = ${dto.baleCount},
          gross_weight_kg = ${grossWeightKg},
          tare_weight_kg = ${tareWeightKg},
          scale_broken = ${scaleBroken},
          delivered_at = NOW(),
          depot_operator_id = ${user.id},
          depot_confirmed_at = NOW(),
          depot_operator_signature_url = ${dto.depotOperatorSignature},
          receiver_name = ${operatorName},
          receiver_signature_url = ${dto.depotOperatorSignature},
          receiver_signed_at = NOW(),
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id} AND status = ${from} RETURNING *`,
      )) as unknown as Record<string, unknown>[];
      if (!updated.length) {
        throw new BadRequestException('Trip status changed concurrently');
      }
      // Mirror the result so retries are no-ops.
      await tx.execute(
        sql`INSERT INTO sync_idempotency (
              client_id, table_name, record_id,
              client_version, server_version, result_data
            ) VALUES (
              ${user.id}, ${idempotencyTable}, ${dto.idempotencyKey},
              1, 1, ${JSON.stringify(updated)}::jsonb
            )
            ON CONFLICT DO NOTHING`,
      );
      return updated;
    });

    this.logTripFlow(id, 'CONFIRM_DELIVERY_AT_DEPOT', from, TripStatus.completed);
    void this.pushToDriver(
      id,
      'Livrare confirmată la depozit',
      'Depozitul a confirmat baloții. Cursa este finalizată.',
      'trip_depot_confirmed',
    );

    // CMR stage 2 — the completed document with the operator (receiver) signature.
    await this.cmrQueue.add('generate', { tripId: id, orgId: orgId, stage: 2 });
    this.winston.log('flow', `CMR generation queued for trip ${id}`, {
      context: 'TripsService',
      tripId: id,
    });

    // Plan C — multi-iteration hook (same as complete()).
    await this.runPostCompleteHooks(trip, orgId);

    // Variant B — a delivered-vs-loaded bale-count discrepancy does NOT block the
    // completion, but surfaces in admin as a high/critical fraud alert. Runs only
    // on a fresh confirmation (idempotent replays returned earlier). Best-effort.
    // Only compare against a real loaded baseline (>0); a trip with no recorded
    // loading has nothing to reconcile against and would just produce noise.
    const loadedBaleCount = Number(trip.bale_count ?? 0);
    if (loadedBaleCount > 0 && dto.baleCount !== loadedBaleCount) {
      try {
        await this.alertsService.createBaleMismatchAlert({
          tripId: id,
          truckId: (trip.truck_id as string | null) ?? null,
          truckLabel:
            (trip.truck_code as string | null) ?? (trip.truck_plate as string | null) ?? null,
          depotName: (trip.destination_name as string | null) ?? null,
          loaded: loadedBaleCount,
          delivered: dto.baleCount,
          orgId,
        });
      } catch (err) {
        this.winston.warn('confirmDepotDelivery: bale-mismatch alert failed', {
          context: 'TripsService',
          tripId: id,
          err: err instanceof Error ? { message: err.message } : err,
        });
      }
    }

    return result;
  }

  // ────────────────────────────────────────────────────────────────────
  // Plan C — Multi-iteration trips (parent_trip_id + iteration_index)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Compute remaining bales on a parcel = SUM(produced) - SUM(loaded).
   * Used by both `createNextIteration` (block when 0) and `complete` hook
   * (decide whether to prompt loader / advance parcel harvest).
   */
  private async computeRemainingBalesOnParcel(
    parcelId: string,
    orgId: string | null,
    executor?: Pick<DrizzleProvider['db'], 'execute'>,
  ): Promise<number> {
    const db = executor ?? this.drizzleProvider.db;
    const rows = (await db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(bale_count) FROM bale_productions
                  WHERE parcel_id = ${parcelId} AND deleted_at IS NULL
                    ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS produced,
        COALESCE((SELECT SUM(bale_count) FROM bale_loads
                  WHERE parcel_id = ${parcelId} AND deleted_at IS NULL
                    ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS loaded
    `)) as unknown as { produced: number; loaded: number }[];
    return Math.max(0, Number(rows[0]?.produced ?? 0) - Number(rows[0]?.loaded ?? 0));
  }

  /**
   * Create the next iteration of a multi-trip course.
   *
   * - Same source_parcel_id, same truck/driver, same loader/loader_operator,
   *   same destination (denormalized fields are copied).
   * - parent_trip_id = root of the current course; iteration_index = next
   *   available index for that root.
   * - status = 'planned'.
   *
   * Idempotency: serializes per course with
   * `pg_advisory_xact_lock(hashtext('iter:' || rootId))` so two parallel
   * recalls don't both produce iteration N+1.
   *
   * If `recall = false`, the row is created but no push is sent — the
   * iteration sits in `planned` until someone picks it up. (In practice
   * recall=false is rarely used; the loader's "no" is handled via
   * recordNoRecall and never creates a new iteration.)
   */
  async createNextIteration(
    currentTripId: string,
    orgId: string | null,
    recall: boolean,
    opts?: { idempotent?: boolean },
  ): Promise<Record<string, unknown>> {
    return this.drizzleProvider.db.transaction(async (tx) => {
      // 1. Load current trip + lookup the course root.
      const cur = (await tx.execute(sql`
        SELECT id, status, parent_trip_id, source_parcel_id, truck_id, driver_id,
               loader_id, loader_operator_id,
               destination_name, destination_address,
               ST_AsGeoJSON(destination_coords) AS destination_coords_geojson,
               recall_decided_at,
               organization_id
          FROM trips
         WHERE id = ${currentTripId}::uuid AND deleted_at IS NULL
         FOR UPDATE
      `)) as unknown as Record<string, unknown>[];
      if (!cur[0]) throw new NotFoundException('Trip not found');
      const t = cur[0];
      if (orgId !== null && t.organization_id !== orgId) {
        throw new ForbiddenException('Trip not found in your organization');
      }
      // A new iteration can only be forked off a *finished* trip — otherwise a
      // caller could fork an arbitrary in-flight trip (wrong truck/status) into
      // a bogus new course. Mirrors recordNoRecall's identical status guard.
      if (t.status !== TripStatus.completed) {
        throw new BadRequestException({
          error: 'invalid_state',
          message: 'Cursa trebuie finalizată înainte de a crea o nouă cursă.',
        });
      }
      // Idempotency (loader path only): a loader recall response mints at most
      // one iteration per trip. If the loader already answered (recalled or
      // declined), reject a duplicate recall=true instead of minting a second
      // iteration (double-tap / network retry / two devices). The FOR UPDATE
      // above holds the row lock so this check is race-free.
      // Admin manual POST /trips/:id/next-iteration passes idempotent=false and
      // may always force another iteration (override of a loader decline).
      if (opts?.idempotent && t.recall_decided_at != null) {
        throw new ConflictException({
          error: 'recall_already_decided',
          message: 'Răspunsul de rechemare a fost deja înregistrat pentru această cursă.',
        });
      }
      const rootId = (t.parent_trip_id as string | null) ?? (t.id as string);

      // 2. Per-course advisory lock to serialize iteration mint.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('iter:' || ${rootId}))`);

      // 3. Compute next iteration_index.
      const next = (await tx.execute(sql`
        SELECT COALESCE(MAX(iteration_index), 0) + 1 AS n
          FROM trips
         WHERE (id = ${rootId}::uuid OR parent_trip_id = ${rootId}::uuid)
           AND deleted_at IS NULL
      `)) as unknown as { n: number }[];
      const iterationIndex = Number(next[0]?.n ?? 2);

      // 4. Block when parcel has no bales left.
      const sourceParcelId = t.source_parcel_id as string | null;
      if (!sourceParcelId) {
        throw new BadRequestException({
          error: 'no_parcel',
          message: 'Cursa nu are parcelă sursă.',
        });
      }
      const remaining = await this.computeRemainingBalesOnParcel(sourceParcelId, orgId, tx);
      if (remaining <= 0) {
        throw new BadRequestException({
          error: 'parcel_fully_loaded',
          message: 'Pe parcelă nu mai sunt baloți pentru o cursă nouă.',
        });
      }

      // 5. Insert new trip row — duplicates denormalized destination.
      const tripNumber = await this.generateTripNumber(orgId, tx);
      const inserted = (await tx.execute(sql`
        INSERT INTO trips (
          organization_id, trip_number, status,
          source_parcel_id, source_parcel_auto,
          truck_id, driver_id,
          loader_id, loader_operator_id,
          destination_name, destination_address,
          destination_coords,
          bale_count,
          parent_trip_id, iteration_index
        ) VALUES (
          ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
          ${tripNumber}, ${TripStatus.planned}::trip_status,
          ${sourceParcelId}, true,
          ${t.truck_id}, ${t.driver_id},
          ${t.loader_id}, ${t.loader_operator_id},
          ${t.destination_name}, ${t.destination_address},
          ${
            t.destination_coords_geojson
              ? sql`ST_GeomFromGeoJSON(${t.destination_coords_geojson as string})`
              : sql`NULL`
          },
          0,
          ${rootId}::uuid, ${iterationIndex}
        )
        RETURNING *
      `)) as unknown as Record<string, unknown>[];
      const newTrip = inserted[0];

      // Record the structured recall decision on the source trip so complete()'s
      // guard suppresses re-prompts and a duplicate response is rejected
      // (migration 00048). Replaces the old delivery_notes [recall_yes] marker.
      await tx.execute(sql`
        UPDATE trips
           SET recall_decision = 'recalled',
               recall_decided_at = NOW(),
               updated_at = NOW()
         WHERE id = ${currentTripId}::uuid
           ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
      `);

      this.logTripFlow(newTrip.id as string, 'NEXT_ITERATION', 'new', TripStatus.planned);
      this.winston.log('flow', `Course ${rootId}: new iteration ${iterationIndex}`, {
        context: 'TripsService',
        rootId,
        iterationIndex,
        recall,
        parcelId: sourceParcelId,
      });

      if (recall) {
        void this.pushToDriver(
          newTrip.id as string,
          'Cursă nouă',
          `Loaderul te cheamă înapoi — cursa ${iterationIndex}.`,
          'trip_next_iteration',
        );
      }
      return newTrip;
    });
  }

  /**
   * Record a loader "no recall" decision on the trip (structured + idempotent).
   * Sets recall_decision='declined' (migration 00048; replaces the old
   * delivery_notes [recall_no] marker) and, when the truck is genuinely idle,
   * alerts admins immediately via {@link alertAdminTruckReleased} — no need to
   * wait for the periodic truck-idle scan. A second decline is a no-op; a
   * decline after a recall is rejected.
   */
  async recordNoRecall(tripId: string, orgId: string | null, loaderId: string): Promise<void> {
    const decided = await this.drizzleProvider.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT t.id, t.status, t.recall_decision, t.recall_decided_at,
               t.truck_id, t.source_parcel_id, t.completed_at,
               COALESCE(t.parent_trip_id, t.id) AS root_id,
               t.organization_id,
               m.internal_code AS truck_code
          FROM trips t
          LEFT JOIN machines m ON m.id = t.truck_id
         WHERE t.id = ${tripId}::uuid
           AND t.deleted_at IS NULL
           ${orgId !== null ? sql`AND t.organization_id = ${orgId}::uuid` : sql``}
         FOR UPDATE OF t
      `)) as unknown as TruckReleaseRow[];
      const row = rows[0];
      if (!row) {
        throw new NotFoundException('Trip not found');
      }
      if (row.status !== TripStatus.completed) {
        throw new BadRequestException({
          error: 'invalid_state',
          message: 'Cursa nu este într-o stare în care recall-ul poate fi refuzat.',
        });
      }
      // Idempotency: at most one recall decision per trip. The FOR UPDATE lock
      // above makes this race-free against a concurrent recall=true.
      if (row.recall_decided_at != null) {
        if (row.recall_decision === 'declined') {
          return { row, alreadyDeclined: true };
        }
        throw new ConflictException({
          error: 'recall_already_decided',
          message: 'Răspunsul de rechemare a fost deja înregistrat pentru această cursă.',
        });
      }
      await tx.execute(sql`
        UPDATE trips
           SET recall_decision = 'declined',
               recall_decided_at = NOW(),
               updated_at = NOW()
         WHERE id = ${tripId}::uuid
           ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
      `);
      return { row, alreadyDeclined: false };
    });

    this.logTripFlow(tripId, 'RECALL_NO', 'completed', 'completed');
    this.winston.log('flow', `Loader ${loaderId} declined recall for trip ${tripId}`, {
      context: 'TripsService',
      tripId,
      loaderId,
    });

    if (!decided.alreadyDeclined) {
      await this.alertAdminTruckReleased(decided.row);
    }
  }

  /**
   * Plan C (P1b) — when a loader explicitly declines recall, alert admins
   * immediately if the truck is genuinely idle (parcel still has bales AND no
   * open iteration on the course). Respects the same 60-min dedup the periodic
   * truck-idle scan uses, so the immediate and periodic paths never
   * double-alert.
   */
  private async alertAdminTruckReleased(row: TruckReleaseRow): Promise<void> {
    try {
      const truckId = row.truck_id;
      const parcelId = row.source_parcel_id;
      const orgId = row.organization_id;
      // Skip cleanly when org is unknown: a null org would fan the push out to
      // every org's admins (sendTruckIdleAdminAlert), and alerts.organization_id
      // is NOT NULL so the insert would fail anyway.
      if (!truckId || !parcelId || orgId === null) return;

      const remaining = await this.computeRemainingBalesOnParcel(parcelId, orgId);
      if (remaining <= 0) return; // nothing left to haul — truck is done, not idle-with-work

      const open = (await this.drizzleProvider.db.execute(sql`
        SELECT COUNT(*)::int AS n FROM trips
         WHERE deleted_at IS NULL
           AND organization_id = ${orgId}::uuid
           AND (id = ${row.root_id}::uuid OR parent_trip_id = ${row.root_id}::uuid)
           AND status IN (
             'planned'::trip_status, 'loading'::trip_status, 'loaded'::trip_status,
             'in_transit'::trip_status, 'arrived'::trip_status, 'delivering'::trip_status
           )
      `)) as unknown as { n: number }[];
      if (Number(open[0]?.n ?? 0) > 0) return;

      // Dedup with the periodic truck-idle scan (truck-idle.processor.ts).
      const existing = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM alerts
         WHERE machine_id = ${truckId}::uuid
           AND organization_id = ${orgId}::uuid
           AND category = 'system'::alert_category
           AND is_acknowledged = false
           AND created_at > NOW() - INTERVAL '60 minutes'
           AND data->>'kind' = 'truck_idle'
         LIMIT 1
      `)) as unknown as { id: string }[];
      if (existing[0]) return;

      const truckCode = row.truck_code ?? '—';
      const completedAt = row.completed_at ?? '';
      await this.alertsService.createTruckIdleAlert({
        truckId,
        truckCode,
        idleMinutes: 0,
        completedAt,
        orgId,
        reason: 'loader_declined',
      });
      await this.notificationsService.sendTruckIdleAdminAlert(
        orgId,
        truckId,
        truckCode,
        completedAt,
        0,
        'loader_declined',
      );
      this.winston.log('flow', `Truck ${truckCode} released by loader — admin alerted`, {
        context: 'TripsService',
        truckId,
      });
    } catch (err) {
      this.winston.warn('alertAdminTruckReleased failed', {
        context: 'TripsService',
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  async cancel(id: string, orgId: string | null, dto: CancelDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'CANCEL');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.cancelled},
        cancelled_at = NOW(),
        cancellation_reason = ${dto.cancellationReason},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'CANCEL', from, TripStatus.cancelled);
    return result;
  }

  /**
   * Admin-only manual status override. Bypasses the state machine entirely so an
   * admin can recover a stuck/edge trip by forcing any status. Sets the matching
   * lifecycle timestamp (departure/arrival/delivered/…) when it is still null so
   * downstream reports and the idle/recall checks stay consistent.
   */
  async forceStatus(id: string, orgId: string | null, dto: ForceStatusDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    const target = dto.status;

    // Fixed map (not user input) → safe to interpolate the column name.
    const stampColumn: Partial<Record<TripStatus, string>> = {
      [TripStatus.loading]: 'loading_started_at',
      [TripStatus.loaded]: 'loading_completed_at',
      [TripStatus.in_transit]: 'departure_at',
      [TripStatus.arrived]: 'arrival_at',
      [TripStatus.delivered]: 'delivered_at',
      [TripStatus.completed]: 'completed_at',
      [TripStatus.cancelled]: 'cancelled_at',
    };

    const setClauses: ReturnType<typeof sql>[] = [sql`status = ${target}`, sql`updated_at = NOW()`];
    const col = stampColumn[target];
    if (col) {
      setClauses.push(sql`${sql.raw(col)} = COALESCE(${sql.raw(col)}, NOW())`);
    }
    if (target === TripStatus.cancelled && dto.reason) {
      setClauses.push(sql`cancellation_reason = ${dto.reason}`);
    }

    const setClause = sql.join(setClauses, sql`, `);
    // Org filter folded into the UPDATE (not just the prior findById) so the
    // write is atomically scoped to the caller's org, matching every other
    // mutation in this file.
    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    // Optional optimistic-lock guard: when the caller supplies expectedStatus,
    // only apply if the trip hasn't moved since they read it (matches the
    // status-guarded pattern used by dispute()/cancel() elsewhere in this file).
    const expectedFilter =
      dto.expectedStatus !== undefined ? sql` AND status = ${dto.expectedStatus}` : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET ${setClause} WHERE id = ${id}${orgFilter}${expectedFilter} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      if (dto.expectedStatus !== undefined) {
        throw new BadRequestException('Trip status changed concurrently');
      }
      throw new BadRequestException('Trip not found');
    }
    this.logTripFlow(id, 'FORCE_STATUS', from, target);
    this.winston.warn(`Admin forced trip ${id} status: ${from} → ${target}`, {
      context: 'TripsService',
      tripId: id,
      from,
      to: target,
      reason: dto.reason ?? null,
    });

    // Auxiliary force-load: an admin forcing an aux trip to `loaded` should behave
    // like a mobile register-load — fire the loaded side-effects once (idempotent)
    // and schedule the delayed auto-complete so it still lands on `completed`.
    if (trip.is_auxiliary === true && target === TripStatus.loaded) {
      await this.applyAuxiliaryLoadedSideEffects(id, orgId);
      await this.scheduleAuxiliaryAutoComplete(id, orgId);
    }

    return result;
  }

  async dispute(id: string, orgId: string | null, _dto: DisputeDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'DISPUTE');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.disputed},
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'DISPUTE', from, TripStatus.disputed);
    void this.pushToDriver(
      id,
      'Dispută transport',
      'Transportul tău a intrat în dispută. Contactează dispeceratul.',
      'trip_disputed',
    );
    return result;
  }

  // ────────────────────────────────────────────────────────────────────
  // Auto-trip from truck task assignment (Option B)
  //
  // When admin wires up a truck task (parent loader + destination),
  // we materialize a Trip in `planned` status so the loader app and the
  // rest of the system have something to work with. Idempotent via
  // `task_assignments.trip_id`; only mutates trips still in `planned`.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Create or update a Trip that mirrors a truck task_assignment.
   * No-op if the task is not a truck, is incomplete, or if no driver is
   * assigned to the truck.
   */
  async autoUpsertFromTruckTask(taskId: string): Promise<void> {
    // Load truck task + machine type in one shot.
    const taskRows = (await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.id, ta.machine_id, ta.parent_assignment_id, ta.destination_id,
        ta.trip_id, ta.deleted_at, ta.organization_id AS "organizationId",
        m.machine_type, m.is_auxiliary
      FROM task_assignments ta
      JOIN machines m ON m.id = ta.machine_id
      WHERE ta.id = ${taskId}
      LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parent_assignment_id: string | null;
      destination_id: string | null;
      trip_id: string | null;
      deleted_at: string | null;
      organizationId: string | null;
      machine_type: string;
      is_auxiliary: boolean;
    }[];
    const task = taskRows[0];
    if (!task || task.deleted_at !== null) return;
    if (task.machine_type !== 'truck') return;

    // Auxiliary trucks have NO driver user and a free-text destination from the
    // request (no destination_id) — handle them on a dedicated path.
    if (task.is_auxiliary) {
      await this.autoUpsertAuxiliaryTrip({
        taskId,
        machineId: task.machine_id,
        parentAssignmentId: task.parent_assignment_id,
        tripId: task.trip_id,
        organizationId: task.organizationId,
      });
      return;
    }

    if (!task.parent_assignment_id || !task.destination_id) {
      // Not enough info yet — keep any existing trip as-is and wait
      // for admin to finish wiring up the task.
      return;
    }

    // Resolve driver: user whose assigned_machine_id == truck. Filter by role
    // so a non-driver who happens to be linked to the truck (e.g. an admin)
    // is never picked as the trip's driver — otherwise every driver push
    // (start-loading, depart, arrive, complete) would go to the wrong person.
    const driverRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id FROM users
          WHERE assigned_machine_id = ${task.machine_id}
            AND role = 'driver'::user_role
            AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1`,
    )) as unknown as { id: string }[];
    const driverId = driverRows[0]?.id ?? null;
    if (!driverId) {
      this.winston.warn(
        `Auto-trip skipped: truck ${task.machine_id} has no driver assigned (users.assigned_machine_id)`,
        { context: 'TripsService', taskId, truckId: task.machine_id },
      );
      return;
    }

    // Resolve parent (loader task) for source parcel + loader machine + loader operator.
    const parentRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, machine_id, parcel_id, assigned_user_id
          FROM task_assignments
          WHERE id = ${task.parent_assignment_id}
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parcel_id: string | null;
      assigned_user_id: string | null;
    }[];
    const parent = parentRows[0];
    if (!parent) return;

    const sourceParcelId = parent.parcel_id;
    const loaderMachineId = parent.machine_id;

    // Loader operator: prefer explicit assigned_user_id on the loader task,
    // fall back to whoever is permanently linked to the loader machine.
    let loaderOperatorId: string | null = parent.assigned_user_id;
    if (!loaderOperatorId && loaderMachineId) {
      // Filter by role so the recall prompt only targets an actual loader
      // operator (who can also answer it — the response endpoint is gated to
      // loader_operator/admin). Better to leave it null than prompt a driver.
      const opRows = (await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users
            WHERE assigned_machine_id = ${loaderMachineId}
              AND role = 'loader_operator'::user_role
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1`,
      )) as unknown as { id: string }[];
      loaderOperatorId = opRows[0]?.id ?? null;
    }

    // Destination details (used to denormalize into trips.destination_*).
    const destRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name, address, ST_AsGeoJSON(coords) AS coords_geojson
          FROM delivery_destinations
          WHERE id = ${task.destination_id} AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { name: string; address: string | null; coords_geojson: string | null }[];
    const dest = destRows[0];
    if (!dest) return;
    const destCoordsGeoJson = dest.coords_geojson;

    if (!task.trip_id) {
      // ── INSERT path
      const taskOrgId = task.organizationId ?? null;
      const tripId = await this.drizzleProvider.db.transaction(async (tx) => {
        const tripNumber = await this.generateTripNumber(taskOrgId, tx);
        const inserted = (await tx.execute(
          sql`INSERT INTO trips (
            organization_id,
            trip_number, status, source_parcel_id, truck_id, driver_id,
            loader_id, loader_operator_id,
            destination_name, destination_address, destination_coords,
            bale_count, source_parcel_auto
          ) VALUES (
            ${taskOrgId ? sql`${taskOrgId}::uuid` : sql`NULL`},
            ${tripNumber}, ${TripStatus.planned}, ${sourceParcelId},
            ${task.machine_id}, ${driverId},
            ${loaderMachineId}, ${loaderOperatorId},
            ${dest.name}, ${dest.address ?? null},
            ${destCoordsGeoJson ? sql`ST_GeomFromGeoJSON(${destCoordsGeoJson})` : sql`NULL`},
            0, false
          ) RETURNING id`,
        )) as unknown as { id: string }[];
        const newTripId = inserted[0]?.id;
        if (!newTripId) return null;

        await tx.execute(
          sql`UPDATE task_assignments SET trip_id = ${newTripId}, updated_at = NOW() WHERE id = ${taskId}`,
        );
        return newTripId;
      });
      if (!tripId) return;

      this.logTripFlow(tripId, 'AUTO_CREATE_FROM_TASK', 'new', TripStatus.planned);
      this.winston.log('flow', `Auto-created trip ${tripId} from truck task ${taskId}`, {
        context: 'TripsService',
        tripId,
        taskId,
        truckId: task.machine_id,
        driverId,
      });
      return;
    }

    // ── UPDATE path: only while trip is still in `planned`.
    const statusRows = (await this.drizzleProvider.db.execute(
      sql`SELECT status FROM trips WHERE id = ${task.trip_id} LIMIT 1`,
    )) as unknown as { status: string }[];
    const currentStatus = statusRows[0]?.status;
    if (!currentStatus) return;
    if (currentStatus !== TripStatus.planned) {
      this.winston.log(
        'flow',
        `Auto-trip update skipped: trip ${task.trip_id} already in status ${currentStatus}`,
        { context: 'TripsService', tripId: task.trip_id, taskId },
      );
      return;
    }

    await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        source_parcel_id = ${sourceParcelId},
        truck_id = ${task.machine_id},
        driver_id = ${driverId},
        loader_id = ${loaderMachineId},
        loader_operator_id = ${loaderOperatorId},
        destination_name = ${dest.name},
        destination_address = ${dest.address ?? null},
        destination_coords = ${destCoordsGeoJson ? sql`ST_GeomFromGeoJSON(${destCoordsGeoJson})` : sql`NULL`},
        updated_at = NOW()
      WHERE id = ${task.trip_id} AND status = ${TripStatus.planned}`,
    );

    this.winston.log('flow', `Auto-updated trip ${task.trip_id} from truck task ${taskId}`, {
      context: 'TripsService',
      tripId: task.trip_id,
      taskId,
    });
  }

  /**
   * Materialize an AUXILIARY (external one-time) truck's trip from its task.
   * Unlike the normal path: driver_id is NULL (external driver only), the
   * destination is the requester's free-text address (no delivery_destination),
   * and on first creation (loader assigned) the external driver is SMS'd the
   * pickup details + loader phone.
   */
  private async autoUpsertAuxiliaryTrip(input: {
    taskId: string;
    machineId: string;
    parentAssignmentId: string | null;
    tripId: string | null;
    organizationId: string | null;
  }): Promise<void> {
    const { taskId, machineId, parentAssignmentId, tripId, organizationId } = input;
    // Need a loader to know the pickup parcel + who loads — wait until set.
    if (!parentAssignmentId) return;

    const parentRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, machine_id, parcel_id, assigned_user_id
          FROM task_assignments
          WHERE id = ${parentAssignmentId} AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parcel_id: string | null;
      assigned_user_id: string | null;
    }[];
    const parent = parentRows[0];
    if (!parent) return;

    const sourceParcelId = parent.parcel_id;
    const loaderMachineId = parent.machine_id;
    let loaderOperatorId: string | null = parent.assigned_user_id;
    if (!loaderOperatorId && loaderMachineId) {
      const opRows = (await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users
            WHERE assigned_machine_id = ${loaderMachineId}
              AND role = 'loader_operator'::user_role
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1`,
      )) as unknown as { id: string }[];
      loaderOperatorId = opRows[0]?.id ?? null;
    }

    // The confirmed request carries the external driver + free-text destination.
    const reqRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, driver_name, driver_phone, driver_email,
                 crop_type, destination_address, destination_locality,
                 company_name, ST_AsGeoJSON(destination_coords) AS coords_geojson
          FROM trip_requests
          WHERE machine_id = ${machineId}::uuid AND deleted_at IS NULL
          ORDER BY confirmed_at DESC NULLS LAST, created_at DESC
          LIMIT 1`,
    )) as unknown as {
      id: string;
      driver_name: string;
      driver_phone: string;
      driver_email: string | null;
      crop_type: string | null;
      destination_address: string | null;
      destination_locality: string | null;
      company_name: string | null;
      coords_geojson: string | null;
    }[];
    const req = reqRows[0];
    if (!req) return;

    const destName = req.destination_locality ?? req.company_name ?? 'Adresă solicitant';
    const destAddress = req.destination_address ?? null;

    if (!tripId) {
      const orgId = organizationId ?? null;
      const newTripId = await this.drizzleProvider.db.transaction(async (tx) => {
        const tripNumber = await this.generateTripNumber(orgId, tx);
        const inserted = (await tx.execute(
          sql`INSERT INTO trips (
                organization_id,
                trip_number, status, source_parcel_id, truck_id, driver_id,
                loader_id, loader_operator_id,
                destination_name, destination_address, destination_coords,
                bale_count, source_parcel_auto,
                is_auxiliary, external_driver_name, external_driver_phone,
                external_driver_email, trip_request_id
              ) VALUES (
                ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
                ${tripNumber}, ${TripStatus.planned}, ${sourceParcelId},
                ${machineId}, NULL,
                ${loaderMachineId}, ${loaderOperatorId},
                ${destName}, ${destAddress},
                ${req.coords_geojson ? sql`ST_GeomFromGeoJSON(${req.coords_geojson})` : sql`NULL`},
                0, false,
                true, ${req.driver_name}, ${req.driver_phone},
                ${req.driver_email ?? null}, ${req.id}::uuid
              ) RETURNING id`,
        )) as unknown as { id: string }[];
        const id = inserted[0]?.id;
        if (!id) return null;
        await tx.execute(
          sql`UPDATE task_assignments SET trip_id = ${id}, updated_at = NOW() WHERE id = ${taskId}`,
        );
        await tx.execute(
          sql`UPDATE trip_requests SET trip_id = ${id}, updated_at = NOW() WHERE id = ${req.id}::uuid`,
        );
        return id;
      });
      if (!newTripId) return;

      this.logTripFlow(newTripId, 'AUTO_CREATE_AUX_FROM_TASK', 'new', TripStatus.planned);
      await this.sendDriverAssignedSms({
        driverPhone: req.driver_phone,
        loaderOperatorId,
        sourceParcelId,
        cropType: req.crop_type,
        tripId: newTripId,
      });
      return;
    }

    // UPDATE path — only while still planned (don't reshape an in-progress trip).
    const statusRows = (await this.drizzleProvider.db.execute(
      sql`SELECT status FROM trips WHERE id = ${tripId} LIMIT 1`,
    )) as unknown as { status: string }[];
    if (statusRows[0]?.status !== TripStatus.planned) return;

    await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            source_parcel_id = ${sourceParcelId},
            loader_id = ${loaderMachineId},
            loader_operator_id = ${loaderOperatorId},
            destination_name = ${destName},
            destination_address = ${destAddress},
            updated_at = NOW()
          WHERE id = ${tripId} AND status = ${TripStatus.planned}`,
    );
  }

  /** SMS the external driver their pickup details + loader phone (stubbed). */
  private async sendDriverAssignedSms(args: {
    driverPhone: string | null;
    loaderOperatorId: string | null;
    sourceParcelId: string | null;
    cropType: string | null;
    tripId: string;
  }): Promise<void> {
    if (!args.driverPhone) return;
    try {
      let loaderName: string | null = null;
      let loaderPhone: string | null = null;
      if (args.loaderOperatorId) {
        const u = (await this.drizzleProvider.db.execute(
          sql`SELECT full_name, phone FROM users WHERE id = ${args.loaderOperatorId}::uuid LIMIT 1`,
        )) as unknown as { full_name: string; phone: string | null }[];
        loaderName = u[0]?.full_name ?? null;
        loaderPhone = u[0]?.phone ?? null;
      }
      let parcelName: string | null = null;
      let locality: string | null = null;
      let mapsUrl: string | null = null;
      if (args.sourceParcelId) {
        const p = (await this.drizzleProvider.db.execute(
          sql`SELECT name, municipality,
                     ST_Y(ST_Centroid(boundary)) AS lat,
                     ST_X(ST_Centroid(boundary)) AS lon
              FROM parcels WHERE id = ${args.sourceParcelId}::uuid LIMIT 1`,
        )) as unknown as {
          name: string;
          municipality: string | null;
          lat: number | null;
          lon: number | null;
        }[];
        parcelName = p[0]?.name ?? null;
        locality = p[0]?.municipality ?? null;
        mapsUrl = fmtCoordsUrl(p[0]?.lat, p[0]?.lon);
      }
      const tpl = messageTemplates[MessageKind.driver_assigned]({
        loaderName,
        loaderPhone,
        parcelName,
        locality,
        mapsUrl,
        cropType: args.cropType,
      });
      await this.messaging.sendSms({
        to: args.driverPhone,
        body: tpl.body,
        kind: MessageKind.driver_assigned,
        metadata: { tripId: args.tripId },
      });
    } catch (err) {
      this.winston.warn('sendDriverAssignedSms failed', {
        context: 'TripsService',
        tripId: args.tripId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /** Public driver page: load summary for a sign token (no auth). */
  async getPublicSignInfo(token: string): Promise<PublicSignInfo> {
    const rows = (await this.drizzleProvider.db
      .execute(
        sql`SELECT t.bale_count, t.public_sign_token_used_at,
                 o.name AS org_name,
                 p.name AS parcel_name, p.municipality AS parcel_municipality,
                 tr.crop_type AS req_crop_type
          FROM trips t
          JOIN organizations o ON o.id = t.organization_id
          LEFT JOIN parcels p ON p.id = t.source_parcel_id
          LEFT JOIN trip_requests tr ON tr.id = t.trip_request_id
          WHERE t.public_sign_token = ${token}
            AND t.is_auxiliary = true
            AND t.deleted_at IS NULL
          LIMIT 1`,
      )
      .catch(() => [])) as unknown as {
      bale_count: number | null;
      public_sign_token_used_at: string | null;
      org_name: string;
      parcel_name: string | null;
      parcel_municipality: string | null;
      req_crop_type: string | null;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Link invalid sau expirat.');
    return {
      organizationName: row.org_name,
      cropType: (row.req_crop_type as PublicSignInfo['cropType']) ?? null,
      baleCount: Number(row.bale_count ?? 0),
      sourceParcelName: row.parcel_name,
      sourceParcelMunicipality: row.parcel_municipality,
      alreadySigned: row.public_sign_token_used_at != null,
    };
  }

  /**
   * Public driver page submit: store the driver's signature (the "last
   * signature") and finalize stage-2 of the CMR. One-time per token.
   */
  async signByPublicToken(token: string, signature: string): Promise<{ ok: true }> {
    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            driver_signature_url = ${signature},
            public_sign_token_used_at = NOW(),
            updated_at = NOW()
          WHERE public_sign_token = ${token}
            AND is_auxiliary = true
            AND deleted_at IS NULL
            AND public_sign_token_used_at IS NULL
          RETURNING id, organization_id`,
    )) as unknown as { id: string; organization_id: string | null }[];
    const row = updated[0];
    if (!row) {
      // Either invalid token or already signed — surface a clear, non-leaky error.
      const exists = (await this.drizzleProvider.db.execute(
        sql`SELECT public_sign_token_used_at FROM trips
            WHERE public_sign_token = ${token} AND is_auxiliary = true AND deleted_at IS NULL
            LIMIT 1`,
      )) as unknown as { public_sign_token_used_at: string | null }[];
      if (exists[0]?.public_sign_token_used_at) {
        throw new ConflictException('Documentul a fost deja semnat.');
      }
      throw new NotFoundException('Link invalid sau expirat.');
    }
    this.logTripFlow(row.id, 'AUX_DRIVER_SIGNED', TripStatus.completed, TripStatus.completed);
    // Stage-2 CMR — finalize the document now that the driver has signed.
    await this.cmrQueue.add('generate', { tripId: row.id, orgId: row.organization_id, stage: 2 });
    return { ok: true };
  }

  /**
   * Cancel a Trip that was auto-created from a truck task_assignment,
   * but only if the trip is still in `planned`. If work already started
   * (loading+) we leave it so ops can finish the real transport.
   */
  async autoCancelForTruckTask(taskId: string): Promise<void> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT trip_id FROM task_assignments WHERE id = ${taskId} LIMIT 1`,
    )) as unknown as { trip_id: string | null }[];
    const tripId = rows[0]?.trip_id ?? null;
    if (!tripId) return;

    const result = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.cancelled},
        cancelled_at = NOW(),
        cancellation_reason = 'Task assignment removed',
        updated_at = NOW()
      WHERE id = ${tripId} AND status = ${TripStatus.planned}
      RETURNING id`,
    )) as unknown as { id: string }[];

    if (result.length > 0) {
      this.logTripFlow(tripId, 'AUTO_CANCEL_FROM_TASK', TripStatus.planned, TripStatus.cancelled);
    } else {
      this.winston.log(
        'flow',
        `Auto-cancel skipped: trip ${tripId} is already past planned (real transport in progress)`,
        { context: 'TripsService', tripId, taskId },
      );
    }
  }

  /**
   * Soft-delete a trip.
   *
   * The originating truck task_assignment KEEPS its `trip_id` pointing at the
   * (now soft-deleted) trip — we deliberately do NOT reset it to NULL. Nulling
   * it made a deliberately-deleted trip indistinguishable from a task that
   * never had one, so the boot backfill (`onModuleInit`) and any later
   * auto-upsert would resurrect it with a fresh `created_at`. Keeping the link
   * preserves the invariant `task_assignments.trip_id IS NULL` ⟺ "never
   * materialized", so a deleted trip stays deleted across restarts. (If work
   * already started, the UPDATE path is also gated on status = 'planned', so a
   * later task edit still can't un-delete it.)
   *
   * Idempotent: if the trip is already soft-deleted, throws 404.
   *
   * Dispatchers can only delete trips in pre-execution statuses; admins may
   * delete a trip in any status (including completed/disputed) for cleanup.
   */
  async softDelete(id: string, orgId: string | null, userRole: UserRole) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;

    if (userRole !== 'admin') {
      const deletableStatuses = ['planned', 'loading', 'loaded', 'cancelled'];
      if (!deletableStatuses.includes(from)) {
        throw new BadRequestException(
          `Tripul cu status "${from}" nu poate fi șters. Anulați-l mai întâi.`,
        );
      }
    }

    // NOTE: we intentionally do NOT clear task_assignments.trip_id here — see the
    // doc comment above. Detaching it would let onModuleInit / autoUpsert
    // resurrect the trip on the next backend boot.
    // Fold the org filter into the UPDATE (not just the prior findById) so the
    // write is atomically scoped to the caller's org, matching forceStatus and
    // every other mutation in this file.
    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} AND deleted_at IS NULL${orgFilter} RETURNING id`,
    );

    this.logTripFlow(id, 'DELETE', from, 'deleted');
    return result;
  }

  /**
   * Set or change the delivery destination for a trip still in planned/loaded status.
   * Only the assigned driver can call this. Used when the trip was auto-created
   * without a destination (no task assignment destination at load time).
   */
  async setDestination(
    id: string,
    orgId: string | null,
    callerId: string,
    dto: { destinationId: string },
  ) {
    const trip = await this.findById(id, orgId);

    if (trip.driver_id !== callerId) {
      throw new ForbiddenException('Only the assigned driver can set the destination');
    }

    const allowedStatuses: string[] = [TripStatus.planned, TripStatus.loaded];
    if (!allowedStatuses.includes(trip.status as string)) {
      throw new BadRequestException('Cannot change destination after trip has departed');
    }

    const destRows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, name, address, ST_AsGeoJSON(coords) AS coords_geojson
          FROM delivery_destinations
          WHERE id = ${dto.destinationId}::uuid
            AND deleted_at IS NULL
            ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
          LIMIT 1`,
    )) as unknown as {
      id: string;
      name: string;
      address: string | null;
      coords_geojson: string | null;
    }[];

    if (!destRows[0]) {
      throw new NotFoundException('Destination not found in your organization');
    }

    const dest = destRows[0];
    // Re-check status atomically inside the UPDATE — the `findById` +
    // `allowedStatuses.includes` check above is only advisory; without this,
    // a concurrent depart() between that check and this write could let the
    // destination change after the trip has already left. Mirrors the
    // check-then-act guard used by depart()/complete()/etc.
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            destination_id      = ${dest.id}::uuid,
            destination_name    = ${dest.name},
            destination_address = ${dest.address ?? null},
            destination_coords  = ${dest.coords_geojson ? sql`ST_GeomFromGeoJSON(${dest.coords_geojson})` : sql`NULL`},
            updated_at          = NOW()
          WHERE id = ${id}
            AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loaded}::trip_status)
            ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
          RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }

    this.logTripFlow(id, 'SET_DESTINATION', trip.status as string, trip.status as string);
    return (result as unknown as Record<string, unknown>[])[0];
  }

  async resolveDispute(id: string, orgId: string | null, dto: ResolveDisputeDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'RESOLVE_DISPUTE');

    const targetStatus =
      dto.resolvedTo === 'completed' ? TripStatus.completed : TripStatus.delivered;

    // A dispute resolved straight to `completed` must mirror complete(): stamp
    // completed_at (truck-idle/recall scans filter on it) and generate the final
    // CMR (stage 2). Without this, such trips have completed_at = NULL and never
    // get their stage-2 document.
    const completedStamp =
      targetStatus === TripStatus.completed
        ? sql`, completed_at = COALESCE(completed_at, NOW())`
        : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${targetStatus},
        updated_at = NOW()${completedStamp}
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'RESOLVE_DISPUTE', from, targetStatus);

    if (targetStatus === TripStatus.completed) {
      await this.cmrQueue.add('generate', { tripId: id, orgId: orgId, stage: 2 });
      this.winston.log('flow', `CMR stage-2 queued for disputed→completed trip ${id}`, {
        context: 'TripsService',
        tripId: id,
      });
    }
    return result;
  }
}
