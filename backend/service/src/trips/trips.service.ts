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
import { SIGNATURE_URL_PATTERN } from '@strawboss/validation';
import { DrizzleProvider } from '../database/drizzle.provider';
import { todayInRomania } from '../common/date';
import { SeasonsService } from '../seasons/seasons.service';
import { clampInt } from '../common/clamp';
import { dateWindowClause, seasonWindow, tsWindowClause } from '../common/season-range';
import { SEGMENT_CAP_M, SPEED_CAP_MS } from '../common/gps-noise';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryDestinationsService } from '../delivery-destinations/delivery-destinations.service';
import { ParcelsService } from '../parcels/parcels.service';
import { AlertsService } from '../alerts/alerts.service';
import { MESSAGING_SERVICE, type IMessagingService } from '../messaging/messaging.tokens';
import { messageTemplates, fmtCoordsUrl } from '../messaging/message-templates';
import {
  TripStatus,
  MessageKind,
  DEFAULT_LOCALE,
  type UserRole,
  type PublicSignInfo,
  type PublicArrivalCmrInfo,
} from '@strawboss/types';
import { QUEUE_CMR_GENERATION } from '../jobs/queues';
import { CmrScansService } from '../cmr-scans/cmr-scans.service';
import type {
  TripCreateDto,
  StartLoadingDto,
  CompleteLoadingDto,
  DepartDto,
  ArriveDto,
  StartDeliveryDto,
  ConfirmDeliveryDto,
  ConfirmDepotDeliveryDto,
  StartDepotUnloadDto,
  ForceStatusDto,
  CompleteDto,
  CancelDto,
  DisputeDto,
  ResolveDisputeDto,
  RegisterLoadDto,
  RegisterLoadResult,
} from '@strawboss/types';
import {
  getAvailableTransitions,
  DEFAULT_MAX_BALES_PER_TRUCK,
  auxTripDestinationName,
} from '@strawboss/domain';
import { isFeatureEnabled } from '@strawboss/types';
import type { FeatureKey, Locale } from '@strawboss/types';
import { FeaturesService } from '../features/features.service';
import { tServer } from '../common';

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
/** Ceiling on `?offset=` — a deep-page scan is a report bug, not a use case. */
const MAX_LIST_OFFSET = 100_000;

/**
 * The client-facing projection of a trip row. Replaces `SELECT t.*` on the two
 * READ endpoints (list + findById), which are reachable by ANY authenticated
 * caller — `GET /trips` carries no @Roles at all.
 *
 * Two things `t.*` got wrong:
 *
 * 1. SECURITY. It shipped `public_sign_token` — the one-time bearer secret that
 *    lets an ACCOUNT-LESS external driver sign the CMR through a public link — to
 *    every driver and loader in the org. Anyone who read it could sign any
 *    auxiliary trip's transport document as the driver. It is deliberately absent
 *    below, and the field is gone from the `Trip` type too, so it cannot be
 *    reintroduced by accident. Nothing needs it client-side: the token is minted
 *    server-side and the sign link is SMS'd to the driver (see sendSignLinkSms).
 *    `public_sign_token_used_at` is NOT a secret and IS kept — the aux read model
 *    surfaces it as "has the driver signed yet".
 *
 * 2. TYPE HONESTY. `destination_coords` is a PostGIS geometry, and postgres.js has
 *    no parser for it, so `t.*` emitted raw EWKB hex ("0101000020E6100000…") while
 *    `Trip.destinationCoords` is declared `GeoPoint | null`. Every other query in
 *    this file already serialises geometry properly. json_build_object gives the
 *    {lat, lon} the type actually promises.
 *
 * Every other column is kept verbatim, in snake_case, so the wire shape is
 * otherwise byte-identical for the ~30 fleet phones and the admin mapper.
 */
const TRIP_COLS = sql`
  t.id,
  t.trip_number,
  t.status,
  t.organization_id,
  t.source_parcel_id,
  t.source_depot_id,
  t.source_parcel_auto,
  t.loader_id,
  t.truck_id,
  t.loader_operator_id,
  t.driver_id,
  t.bale_count,
  t.delivered_bale_count,
  t.deteriorated_bales_count,
  t.loading_started_at,
  t.loading_completed_at,
  t.departure_at,
  t.arrival_at,
  t.gps_distance_km,
  t.destination_id,
  t.destination_name,
  t.destination_address,
  CASE WHEN t.destination_coords IS NULL THEN NULL
       ELSE json_build_object('lat', ST_Y(t.destination_coords),
                              'lon', ST_X(t.destination_coords))
  END                                            AS destination_coords,
  t.gross_weight_kg,
  t.tare_weight_kg,
  t.net_weight_kg,
  t.weight_ticket_number,
  t.weight_ticket_photo_url,
  t.delivered_at,
  t.delivery_notes,
  t.receiver_name,
  t.receiver_signature_url,
  t.receiver_signed_at,
  t.loader_signature_url,
  t.driver_signature_url,
  t.depot_operator_id,
  t.depot_confirmed_at,
  t.depot_operator_signature_url,
  t.scale_broken,
  t.completed_at,
  t.cancelled_at,
  t.cancellation_reason,
  t.parent_trip_id,
  t.iteration_index,
  t.recall_decision,
  t.recall_decided_at,
  t.is_auxiliary,
  t.external_driver_name,
  t.external_driver_phone,
  t.external_driver_email,
  t.public_sign_token_used_at,
  t.trip_request_id,
  t.fraud_flags,
  t.client_id,
  t.sync_version,
  t.created_at,
  t.updated_at,
  t.deleted_at
`;

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
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly deliveryDestinationsService: DeliveryDestinationsService,
    private readonly parcelsService: ParcelsService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
    @Inject(MESSAGING_SERVICE) private readonly messaging: IMessagingService,
    private readonly cmrScansService: CmrScansService,
    private readonly features: FeaturesService,
    private readonly seasons: SeasonsService,
  ) {}

  /** Public web base URL for driver-facing links (arrival-CMR upload). */
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

  /**
   * `key`/`params` render through `NotificationsService.sendPush`'s server
   * i18n catalog. `params` may be a plain object, or — when a value needs a
   * locale-correct fallback word (e.g. tripDeparted's destination) — a
   * function of the resolved recipient `Locale`, since that locale is only
   * known here (after `driver_id` is fetched), not at the call site.
   */
  private async pushToDriver(
    tripId: string,
    key: string,
    params:
      | Record<string, string | number>
      | ((locale: Locale) => Record<string, string | number>)
      | undefined,
    type: string,
  ): Promise<void> {
    try {
      const rows = (await this.drizzleProvider.db.execute(
        sql`SELECT driver_id FROM trips WHERE id = ${tripId} AND driver_id IS NOT NULL LIMIT 1`,
      )) as unknown as { driver_id: string }[];
      const driverId = rows[0]?.driver_id;
      if (driverId) {
        const resolvedParams =
          typeof params === 'function'
            ? params(await this.notificationsService.localeForUser(driverId))
            : params;
        await this.notificationsService.sendPush(driverId, key, resolvedParams, { type, tripId });
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
      /**
       * Opt-in pagination. Present ⇒ the query is paged AND every row carries a
       * `total_count` window column so the caller knows when to stop.
       *
       * Absent ⇒ the historical behaviour, unchanged: `LIMIT TRIP_LIST_CAP`, no
       * offset, no extra column. That default is load-bearing — the fleet
       * phones and several admin pages poll this endpoint and must not start
       * paying for a window function, nor start receiving a key they never had.
       */
      pageSize?: number;
      offset?: number;
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

    /*
     * Pagination, opt-in on `pageSize` — same contract as `include=refs` above.
     *
     * `count(*) OVER()` is what lets one round trip answer both "here is the
     * page" and "how many are there in total", which a season-wide report needs
     * to say "1 of 3 pages" honestly rather than guessing from a short page.
     * It is emitted ONLY on the paged path: the unpaged one is hit in a loop by
     * ~30 fleet phones, and making them all pay for a window function — and
     * handing them a column that was not there yesterday — for a report they
     * never open would be the wrong trade.
     *
     * The `min = 1` on the page size matters: `Number('')` is 0, and a bare
     * `?pageSize=` would otherwise become `LIMIT 0` — an empty report that
     * looks exactly like "there is no data".
     */
    const paged = filters?.pageSize !== undefined;
    const limit = clampInt(filters?.pageSize, TRIP_LIST_CAP, TRIP_LIST_CAP, 1);
    const offset = clampInt(filters?.offset, 0, MAX_LIST_OFFSET);
    const totalSelect = paged ? sql`, count(*) OVER() AS total_count` : sql``;
    const result = await this.drizzleProvider.db.execute(
      sql`
        SELECT
          ${TRIP_COLS},
          m.registration_plate                         AS truck_plate,
          m.internal_code                              AS truck_code,
          u.full_name                                  AS driver_name,
          p.name                                       AS source_parcel_name,
          p.code                                       AS source_parcel_code,
          p.municipality                               AS source_parcel_municipality,
          f.name                                       AS source_farm_name,
          sd.name                                      AS source_depot_name${refsSelect}${totalSelect}
        FROM trips t
        LEFT JOIN machines m ON m.id = t.truck_id
        LEFT JOIN users    u ON u.id = t.driver_id
        LEFT JOIN parcels  p ON p.id = t.source_parcel_id
        LEFT JOIN farms    f ON f.id = p.farm_id
        LEFT JOIN delivery_destinations sd ON sd.id = t.source_depot_id
        WHERE ${where}
        -- t.id DESC is load-bearing now that the reports ledger PAGES this
        -- endpoint (pageSize/offset -> packages/api paged-ledger.ts): OFFSET over
        -- a non-unique ORDER BY can duplicate a row on one page and skip it on
        -- the next. trips.created_at defaults to now(), the TRANSACTION clock,
        -- and several paths mint more than one trip per transaction, so ties are
        -- routine rather than theoretical. Same fix as TripRequestsService.list().
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );
    return result;
  }

  async findById(id: string, orgId?: string | null) {
    /*
     * `destination_has_operator` is a LIVENESS flag, not just a label: the
     * driver's app hides its own confirm button whenever it is true, and waits
     * for the depot operator instead. So it must be a product of BOTH facts —
     * a depot manager exists AND the org still has manned confirmation on.
     *
     * Without the second term, switching `depot.manned_confirm` off while a
     * truck sits at `arrived` would strand the trip: the depot operator's
     * endpoint now 403s, and the driver's phone still holds the cached `true`
     * and shows no button. Only an admin `force-status` could rescue it, and
     * the state survives offline indefinitely.
     */
    const mannedConfirmEnabled = orgId
      ? isFeatureEnabled(await this.features.getDisabledForOrg(orgId), 'depot.manned_confirm')
      : true;
    const conditions: ReturnType<typeof sql>[] = [sql`t.id = ${id}`, sql`t.deleted_at IS NULL`];
    if (orgId !== null && orgId !== undefined) {
      conditions.push(sql`t.organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    // TRIP_COLS keeps every trip column that internal callers rely on — it is
    // `t.*` minus the one bearer secret (public_sign_token) and with the geometry
    // serialised. Internal reads of the token use their own dedicated queries.
    // The extra LEFT JOIN labels let the admin show real names, not raw UUIDs.
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
            ${TRIP_COLS},
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
            ((dep.id IS NOT NULL) AND ${mannedConfirmEnabled})
                                  AS destination_has_operator,
            dep.full_name         AS destination_operator_name,
            dep.phone             AS destination_operator_phone
          FROM trips t
          LEFT JOIN machines m  ON m.id  = t.truck_id
          LEFT JOIN users    u  ON u.id  = t.driver_id
          LEFT JOIN machines lm ON lm.id = t.loader_id
          LEFT JOIN users    lo ON lo.id = t.loader_operator_id
          LEFT JOIN parcels  p  ON p.id  = t.source_parcel_id
          LEFT JOIN farms    f  ON f.id  = p.farm_id
          LEFT JOIN delivery_destinations sd ON sd.id = t.source_depot_id
          -- Was a bare EXISTS(); widened to LATERAL so the waiting driver gets a
          -- name and a phone number instead of an anonymous hourglass. Still one
          -- row at most, so destination_has_operator is unchanged.
          LEFT JOIN LATERAL (
            SELECT du.id, du.full_name, du.phone
            FROM users du
            WHERE du.assigned_delivery_destination_id = t.destination_id
              AND du.organization_id = t.organization_id
              AND du.role = 'depot_manager'::user_role
              AND du.deleted_at IS NULL
            ORDER BY du.created_at ASC
            LIMIT 1
          ) dep ON TRUE
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
        // destination_id: carried so an admin-created trip is visible to the depot
        // manager and can be depot-confirmed, like every other creation path.
        //
        // destination_coords: the old code bound `JSON.stringify({lat, lon})`
        // straight into a GEOMETRY column, which Postgres cannot parse — passing
        // coords here would always have thrown. (Nothing calls POST /trips today,
        // which is why nobody hit it.) ST_MakePoint takes lon,lat in that order.
        sql`INSERT INTO trips (
          organization_id,
          trip_number, status, source_parcel_id, truck_id, driver_id,
          loader_id, loader_operator_id,
          destination_id, destination_name,
          destination_address, destination_coords,
          bale_count, source_parcel_auto
        ) VALUES (
          ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
          ${tripNumber}, ${TripStatus.planned}, ${dto.sourceParcelId},
          ${dto.truckId}, ${dto.driverId},
          ${dto.loaderId ?? null}, ${dto.loaderOperatorId ?? null},
          ${dto.destinationId ? sql`${dto.destinationId}::uuid` : sql`NULL`},
          ${dto.destinationName ?? null}, ${dto.destinationAddress ?? null},
          ${
            dto.destinationCoords
              ? sql`ST_SetSRID(ST_MakePoint(${dto.destinationCoords.lon}, ${dto.destinationCoords.lat}), 4326)`
              : sql`NULL`
          },
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
    void this.pushToDriver(id, 'push.startLoading', undefined, 'assignment_created');
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
    void this.pushToDriver(id, 'push.tripLoaded', undefined, 'trip_loaded');
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
    const resolvedLoaderSignature = await this.resolveSpecimenSignature(
      callerId,
      dto.loaderSignature,
    );

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
          // destination_id, not just the denormalized name/address/coords. It was
          // resolved above and then thrown away, which left the FK NULL on every
          // trip this path creates — and destination_id is what the depot-manager
          // sync pull, the depot_manager RLS policies and confirmDepotDelivery all
          // key on. Without it the entire depot-confirmation flow was dead.
          sql`INSERT INTO trips (
                organization_id,
                trip_number, status,
                source_parcel_id, source_depot_id, source_parcel_auto,
                truck_id, driver_id,
                loader_id, loader_operator_id,
                destination_id, destination_name, destination_address, destination_coords,
                bale_count
              ) VALUES (
                ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
                ${tripNumber}, ${TripStatus.planned}::trip_status,
                ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId}`},
                ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
                ${dto.sourceDepotId ? sql`false` : sql`true`},
                ${dto.truckId}, ${driverId},
                ${dto.loaderMachineId}, ${callerId},
                ${destinationId ? sql`${destinationId}::uuid` : sql`NULL`},
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
        if (!dto.sourceDepotId && dto.parcelId) {
          // Counted exactly as computeRemainingBalesOnParcel and
          // ParcelsService.getBaleAvailability do — operator rows PLUS signed
          // admin corrections, within the active season. All three used to
          // disagree; this one ignoring `parcel_bale_adjustments` was the worst
          // of the three, because it meant an admin could raise a field's count
          // on screen and the loader would still be refused in the field.
          const { produced, loaded, remaining } = await this.parcelBaleTally(
            dto.parcelId,
            orgId,
            tx,
          );

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
              bale_count, loaded_at, gps_lat, gps_lon, location_unverified
            ) VALUES (
              ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
              ${dto.idempotencyKey}, ${tripId},
              ${dto.sourceDepotId ? sql`NULL` : sql`${dto.parcelId}`},
              ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
              ${dto.loaderMachineId}, ${callerId},
              ${dto.baleCount}, NOW(),
              ${dto.gpsLat ?? null}, ${dto.gpsLon ?? null},
              ${dto.locationUnverified === true}
            )`,
      );

      // Transition trip → loaded (collapses planned → loading → loaded so
      // the driver immediately sees a "ready to depart" trip).
      const updated = (await tx.execute(
        sql`UPDATE trips SET
              status = ${TripStatus.loaded}::trip_status,
              loading_started_at = COALESCE(loading_started_at, NOW()),
              loading_completed_at = NOW(),
              loader_signature_url = ${resolvedLoaderSignature},
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

    if (dto.locationUnverified === true) {
      this.winston.warn(
        `register-load: geofence unverified, operator confirmed (trip ${result.trip.id as string})`,
        { context: 'TripsService', tripId: result.trip.id },
      );
    }
    this.logTripFlow(
      result.trip.id as string,
      'REGISTER_LOAD',
      result.created ? 'new' : (result.trip.status as string),
      TripStatus.loaded,
    );
    void this.pushToDriver(result.trip.id as string, 'push.tripLoaded', undefined, 'trip_loaded');

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
  /**
   * A caller's signature on a trip action (loader registering a load, depot
   * operator confirming a delivery) is ALWAYS their pre-registered SPECIMEN — the
   * phone draws nothing (or, for the depot operator, draws something the server
   * ignores), it just echoes back the URL it cached at login. The server already
   * stores that specimen on `users.signature_specimen_url`, so there is no reason
   * to trust the client's copy of it.
   *
   * This is not a tidy-up — it is the fix for a live field outage, generalized.
   * Commit 111d4b1 (the security audit, deployed 08.07) tightened the loader's DTO
   * from `loaderSignature: z.string()` to a strict URL allowlist. Any phone whose
   * cached specimen URL no longer matched the new shape had its loads REJECTED at
   * the validation boundary — a hard 400 which, thanks to the ZodValidationPipe
   * bug, surfaced as "Internal server error". The one loader operator using this
   * screen could not register a load for six days and nobody could see why.
   * `confirmDepotDeliverySchema.depotOperatorSignature` had the identical shape
   * (required + strict `signatureUrlSchema`) and the identical failure mode — a
   * failed binary upload fell back to raw base64, which can never pass the
   * allowlist, wedging `confirm-depot-delivery` in the sync queue forever.
   *
   * Resolving server-side makes the whole class of failure impossible: a stale,
   * malformed or absent client value can no longer break a trip transition, and
   * the client can no longer smuggle an arbitrary URL into an `<img src>` — which
   * is what the audit was defending against in the first place. The client value
   * is used only as a fallback, and only when it already satisfies the allowlist.
   */
  private async resolveSpecimenSignature(
    callerId: string,
    clientValue?: string | null,
  ): Promise<string | null> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT signature_specimen_url FROM users
           WHERE id = ${callerId}::uuid AND deleted_at IS NULL
           LIMIT 1`,
    )) as unknown as { signature_specimen_url: string | null }[];
    const specimen = rows[0]?.signature_specimen_url ?? null;

    if (specimen) {
      if (clientValue && clientValue !== specimen) {
        // The phone is carrying a stale specimen URL. Harmless now — but this is the
        // fingerprint of the outage above, so it is worth seeing in the logs.
        this.winston.warn('Signature specimen mismatch — using the stored one', {
          context: 'TripsService',
          userId: callerId,
          stored: specimen,
          sentByClient: clientValue,
        });
      }
      return specimen;
    }

    // No specimen on file: fall back to the client's value ONLY if it satisfies the
    // allowlist, so an unvalidated URL can never be persisted.
    return clientValue && SIGNATURE_URL_PATTERN.test(clientValue) ? clientValue : null;
  }

  private async registerAuxiliaryLoad(
    dto: RegisterLoadInput,
    callerId: string,
    orgId: string | null,
  ): Promise<RegisterLoadResult> {
    const resolvedLoaderSignature = await this.resolveSpecimenSignature(
      callerId,
      dto.loaderSignature,
    );
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
              loader_signature_url = ${resolvedLoaderSignature},
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

    // Fire the loaded side-effects (sign-token + stage-1 CMR + driver SMS +
    // retire the one-time truck) — idempotent, shared with the admin
    // force-load path. There is nothing to schedule: the trip now waits for
    // the arrival-CMR upload (completeAuxiliaryOnArrivalCmr) instead of a timer.
    await this.applyAuxiliaryLoadedSideEffects(tripId, orgId);

    return result;
  }

  /**
   * Idempotent side-effects fired when an auxiliary trip enters `loaded` (from a
   * mobile register-load OR an admin force-status). Gated on atomically claiming
   * `public_sign_token`, so it runs EXACTLY ONCE even if called from several
   * paths: mints the driver's one-time token, retires the one-time aux truck
   * (soft delete — it drops out of the fleet list but stays readable for CMR +
   * trip history), queues the stage-1 (loading) CMR, and SMSs the external
   * driver the link to upload the arrival CMR once they reach their
   * destination. All best-effort — failures are logged, never thrown.
   */
  private async applyAuxiliaryLoadedSideEffects(
    tripId: string,
    orgId: string | null,
  ): Promise<void> {
    const token = randomUUID();
    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;
    // Atomic claim: only the first caller (token still null) proceeds; a second
    // caller (redundant admin force) gets 0 rows.
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

    // SMS the external driver a one-time link to upload the arrival CMR.
    const driverPhone = row.external_driver_phone;
    if (driverPhone) {
      const slug = await this.resolveOrgSlug(row.organization_id);
      const cmrUrl = slug
        ? `${this.publicWebBaseUrl()}/${slug}/cmr/${token}`
        : `${this.publicWebBaseUrl()}/cmr/${token}`;
      // Locale: `row.external_driver_phone` is a free-text field on an
      // auxiliary trip (`is_auxiliary = true`) — this driver has no `users`
      // row, so there is no locale preference to read. DEFAULT_LOCALE matches
      // the pre-existing (always-Romanian) behavior.
      const tpl = messageTemplates[MessageKind.driver_arrival_cmr_link][DEFAULT_LOCALE]({
        cmrUrl,
        baleCount: Number(row.bale_count ?? 0),
      });
      void this.messaging
        .sendSms({
          to: driverPhone,
          body: tpl.body,
          kind: MessageKind.driver_arrival_cmr_link,
          // orgId is load-bearing, not decoration: the messaging gate reads the
          // org out of this metadata, and without it the gate fails OPEN.
          metadata: { tripId, orgId },
        })
        .catch((err) =>
          this.winston.warn('applyAuxiliaryLoadedSideEffects: arrival-CMR link SMS failed', {
            context: 'TripsService',
            tripId,
            err: err instanceof Error ? { message: err.message } : err,
          }),
        );
    }
  }

  /**
   * Public driver page: load summary for the arrival-CMR upload link (no auth).
   * Historically this token backed a "sign the CMR" flow — see the note on
   * `publicSignToken` in @strawboss/types — the token and its one-time-use
   * guarantee carry over unchanged, only what the driver does at the link end
   * has changed (upload a photo instead of drawing a signature).
   */
  async getPublicArrivalCmrInfo(token: string): Promise<PublicArrivalCmrInfo> {
    const rows = (await this.drizzleProvider.db
      .execute(
        sql`SELECT t.bale_count, t.public_sign_token_used_at,
                 t.destination_name, t.destination_address,
                 o.name AS org_name,
                 m.registration_plate AS truck_plate
          FROM trips t
          JOIN organizations o ON o.id = t.organization_id
          LEFT JOIN machines m ON m.id = t.truck_id
          WHERE t.public_sign_token = ${token}
            AND t.is_auxiliary = true
            AND t.deleted_at IS NULL
          LIMIT 1`,
      )
      .catch(() => [])) as unknown as {
      bale_count: number | null;
      public_sign_token_used_at: string | null;
      destination_name: string | null;
      destination_address: string | null;
      org_name: string;
      truck_plate: string | null;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Link invalid sau expirat.');
    return {
      organizationName: row.org_name,
      truckPlate: row.truck_plate,
      baleCount: Number(row.bale_count ?? 0),
      destinationName: row.destination_name,
      destinationAddress: row.destination_address,
      alreadyUploaded: row.public_sign_token_used_at != null,
    };
  }

  /**
   * Public driver page submit: the external driver has reached the
   * destination and uploads 1..N photos of the arrival CMR. This is the ONLY
   * thing that completes an auxiliary trip (besides an admin force-complete
   * with a reason) — there is no timer.
   *
   * Rendering the photos into a PDF is slow (Puppeteer) and deliberately runs
   * OUTSIDE any transaction. Filing the document and flipping the trip to
   * `completed` then happen together in ONE transaction — re-checking
   * eligibility under the same guard the fast up-front check uses, so a
   * concurrent duplicate submission (a double-tap on a slow connection) can
   * insert at most one document and complete the trip at most once. One-time
   * per token, same as the old sign flow.
   */
  async completeAuxiliaryOnArrivalCmr(
    token: string,
    parts: { mimetype: string; buffer: Buffer }[],
    scanId?: string | null,
  ): Promise<{ ok: true }> {
    const found = (await this.drizzleProvider.db.execute(
      sql`SELECT id, organization_id, trip_request_id, status, public_sign_token_used_at
          FROM trips
          WHERE public_sign_token = ${token}
            AND is_auxiliary = true
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as {
      id: string;
      organization_id: string | null;
      trip_request_id: string | null;
      status: TripStatus;
      public_sign_token_used_at: string | null;
    }[];
    const trip = found[0];
    if (!trip || !trip.trip_request_id || !trip.organization_id) {
      throw new NotFoundException('Link invalid sau expirat.');
    }
    // Fast fail before the expensive render — the definitive check is the
    // guarded UPDATE inside the transaction below.
    if (trip.public_sign_token_used_at || trip.status !== TripStatus.loaded) {
      throw new ConflictException('Documentul de sosire a fost deja încărcat.');
    }

    const orgId = trip.organization_id;
    // @Public() route: the org is only knowable from the token, and everything
    // below is destructive to the one-time link. Free here — the SELECT above
    // already resolved the org.
    await this.features.assertEnabledForOrg(orgId, 'documents.cmr_scan');

    const saved = await this.cmrScansService.saveArrivalCmrFile(parts, scanId);

    await this.drizzleProvider.db.transaction(async (tx) => {
      await this.cmrScansService.attachArrivalCmr(
        orgId,
        trip.trip_request_id as string,
        saved,
        parts.length,
        tx,
      );
      const completed = (await tx.execute(
        sql`UPDATE trips SET
              status = ${TripStatus.completed}::trip_status,
              completed_at = COALESCE(completed_at, NOW()),
              public_sign_token_used_at = NOW(),
              updated_at = NOW()
            WHERE id = ${trip.id}
              AND is_auxiliary = true
              AND status = ${TripStatus.loaded}::trip_status
              AND public_sign_token_used_at IS NULL
            RETURNING id`,
      )) as unknown as { id: string }[];
      if (!completed.length) {
        // Lost a race with a concurrent submission — roll back the document
        // insert too, so the loser leaves no trace.
        throw new ConflictException('Documentul de sosire a fost deja încărcat.');
      }
    });

    this.logTripFlow(trip.id, 'AUX_ARRIVAL_CMR_UPLOADED', TripStatus.loaded, TripStatus.completed);
    // Stage-2 CMR — finalize the document now that the trip is done.
    await this.cmrQueue.add('generate', { tripId: trip.id, orgId, stage: 2 }).catch((err) =>
      this.winston.warn('completeAuxiliaryOnArrivalCmr: CMR enqueue failed', {
        context: 'TripsService',
        tripId: trip.id,
        err: err instanceof Error ? { message: err.message } : err,
      }),
    );
    return { ok: true };
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

  async depart(id: string, orgId: string | null, _dto: DepartDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'DEPART');

    // No driver signature is collected anymore — driver_signature_url stays NULL.
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.in_transit},
        departure_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'DEPART', from, TripStatus.in_transit);
    const destinationName = trip.destination_name as string | null;
    void this.pushToDriver(
      id,
      'push.tripDeparted',
      (locale) => ({ destination: destinationName ?? tServer(locale, 'push.common.destination') }),
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

  /**
   * Trip distance from the truck's GPS track between `departure_at` and now,
   * summed pairwise with ST_DistanceSphere — same approach as
   * location.service.getKmByDay. NULL/zero-ping cases COALESCE to 0. The hourly
   * reconciliation job recomputes this for recently-arrived trips to pick up
   * pings that synced late from the phone.
   *
   * Correlated on the `t` alias, so it only composes inside `UPDATE trips AS t`.
   * Shared by `arrive()` and by the depot-operator paths, which stamp arrival on
   * the driver's behalf — inlining it in only one of them silently loses the
   * kilometres of every trip the operator closes.
   */
  private gpsDistanceKmExpr() {
    return sql`(
      SELECT ROUND((COALESCE(SUM(
        -- Drop GPS noise using the SAME caps as reports.service.ts, from the
        -- shared gps-noise constants — hardcoding them here is how arrive()
        -- and the reports end up disagreeing on a trip's distance.
        CASE
          WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
          WHEN leg_m > ${SEGMENT_CAP_M} THEN 0
          WHEN (leg_m / dt_s) > ${SPEED_CAP_MS} THEN 0
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
    )`;
  }

  async arrive(id: string, orgId: string | null, _dto: ArriveDto) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    this.validateTransition(from, 'ARRIVE');

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips AS t SET
        status = ${TripStatus.arrived},
        arrival_at = NOW(),
        gps_distance_km = ${this.gpsDistanceKmExpr()},
        updated_at = NOW()
      WHERE t.id = ${id} AND t.status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'ARRIVE', from, TripStatus.arrived);
    void this.pushToDriver(id, 'push.tripArrived', undefined, 'trip_arrived');
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
    // scaleBroken (mirrors confirmDepotDelivery) — the depot has no working
    // scale, so the driver delivers without weighing and both columns stay NULL.
    const scaleBroken = dto.scaleBroken === true;
    let grossWeightKg: number | null = null;
    let tareWeightKg: number | null = null;
    if (!scaleBroken) {
      if (typeof dto.grossWeightKg !== 'number' || dto.grossWeightKg <= 0) {
        throw new BadRequestException({
          error: 'gross_weight_required',
          message: 'Este necesară greutatea brută (sau marcați livrarea fără cântărire).',
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
        scale_broken = ${scaleBroken},
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

    // No receiver signature is collected in the driver's self-confirm flow
    // anymore — receiver_signature_url/receiver_signed_at stay NULL.
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
        status = ${TripStatus.completed},
        receiver_name = ${dto.receiverName},
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND status = ${from} RETURNING *`,
    );
    if (!(result as unknown as unknown[]).length) {
      throw new BadRequestException('Trip status changed concurrently');
    }
    this.logTripFlow(id, 'COMPLETE', from, TripStatus.completed);
    void this.pushToDriver(id, 'push.tripCompleted', undefined, 'trip_completed');

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
   * Everything both depot-operator steps must establish before they may touch a
   * trip: which depot this is, that the caller runs it, and whether the truck is
   * verifiably standing in it.
   *
   * Extracted because `startDepotUnload` and `confirmDepotDelivery` have to agree
   * exactly — an operator who is allowed to start unloading a truck and then not
   * allowed to close it leaves the driver stranded mid-flow, which is the failure
   * this whole feature exists to remove.
   *
   * Returns the resolved depot id so the caller can adopt an unlinked trip (see
   * `destinationLinked` below).
   */
  private async resolveDepotAction(
    trip: Record<string, unknown>,
    user: { id: string; role: string; organizationId: string | null },
    opts: { locationUnverified?: boolean },
  ): Promise<{ destinationId: string; adopted: boolean; locationUnverified: boolean }> {
    const orgId = user.organizationId;

    /*
     * The operator's own assigned depot is the anchor, not the trip's
     * destination_id. A trip whose destination was never linked (NULL — the
     * pre-00085 leftovers, or any path that forgot to set it) used to be
     * unconfirmable with `no_destination` while sitting right there on the
     * operator's screen. It can now be adopted, but only on the strict terms
     * below: real GPS inside the perimeter, no override.
     */
    let assignedId: string | null = null;
    if (user.role !== 'admin') {
      const userRows = (await this.drizzleProvider.db.execute(sql`
        SELECT assigned_delivery_destination_id AS "assignedId"
          FROM users
         WHERE id = ${user.id}::uuid AND deleted_at IS NULL
           ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
         LIMIT 1
      `)) as unknown as { assignedId: string | null }[];
      assignedId = userRows[0]?.assignedId ?? null;
    }

    const tripDestinationId = (trip.destination_id as string | null) ?? null;
    const destinationId = tripDestinationId ?? assignedId;
    if (!destinationId) {
      throw new BadRequestException({
        error: 'no_destination',
        message: 'Cursa nu are un depozit de destinație.',
      });
    }
    const adopted = tripDestinationId === null;

    // Authorization: a depot_manager may only act at their assigned depot (admin
    // bypasses). Mirrors deposit-inventory.ensureUserCanAccessDepot.
    if (user.role !== 'admin' && assignedId !== destinationId) {
      throw new ForbiddenException('You can only confirm deliveries at your assigned depot');
    }

    // Depot geofence config.
    const depotRows = (await this.drizzleProvider.db.execute(sql`
      SELECT confirm_radius_m AS "confirmRadiusM",
             (coords IS NOT NULL) AS "hasCoords",
             (boundary IS NOT NULL) AS "hasBoundary"
        FROM delivery_destinations
       WHERE id = ${destinationId}::uuid AND deleted_at IS NULL
         ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
       LIMIT 1
    `)) as unknown as { confirmRadiusM: number; hasCoords: boolean; hasBoundary: boolean }[];
    const depot = depotRows[0];
    if (!depot) {
      throw new BadRequestException({
        error: 'depot_not_found',
        message: 'Depozitul nu a fost găsit.',
      });
    }
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
    const verified = geo?.hasFix === true && geo.inside === true;

    /*
     * The geofence is anti-fraud, never authorization — that was settled above by
     * the depot assignment. A fleet phone in deep Doze reports no fix for hours,
     * so refusing outright leaves an operator unable to close a truck he has
     * physically unloaded. He may override; the trip is flagged
     * (depot_confirm_location_unverified) and raises an alert for admin review.
     *
     * The one thing an override may NOT do is adopt an unlinked trip: without a
     * destination_id, the GPS match is the ONLY evidence this truck was ever
     * headed here, so waiving it would let any operator claim any nearby trip.
     */
    if (!verified) {
      if (adopted || opts.locationUnverified !== true) {
        if (!geo?.hasFix) {
          throw new BadRequestException({
            error: 'gps_stale',
            message: 'Camionul nu a transmis o poziție GPS recentă. Așteaptă o actualizare.',
            canOverride: !adopted,
          });
        }
        throw new BadRequestException({
          error: 'outside_geofence',
          message: 'Camionul nu este în perimetrul depozitului.',
          distanceM: geo.distanceM,
          radiusM: depot.confirmRadiusM,
          canOverride: !adopted,
        });
      }
    }

    return { destinationId, adopted, locationUnverified: !verified };
  }

  /**
   * Best-effort fraud alert for a depot action taken with the truck's GPS
   * unverified. Never throws: the trip has already moved by the time this runs,
   * and an alert failure must not undo a delivery the operator physically saw.
   */
  private async raiseDepotOverrideAlert(
    tripId: string,
    trip: Record<string, unknown>,
    orgId: string | null,
  ): Promise<void> {
    try {
      await this.alertsService.createDepotOverrideAlert({
        tripId,
        truckId: (trip.truck_id as string | null) ?? null,
        truckLabel:
          (trip.truck_code as string | null) ?? (trip.truck_plate as string | null) ?? null,
        depotName: (trip.destination_name as string | null) ?? null,
        orgId,
      });
    } catch (err) {
      this.winston.warn('depot action: location-override alert failed', {
        context: 'TripsService',
        tripId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /**
   * Step 1 of the manned-depot flow — the operator starts unloading (→
   * `delivering`). Its only job is to tell the waiting driver that work has
   * begun; no counts, no weights.
   *
   * Legal from `in_transit` as well as `arrived`: the operator at the ramp is a
   * better witness of arrival than a button drivers routinely forget, so this
   * stamps `arrival_at` and the GPS distance on their behalf when it fires early.
   */
  async startDepotUnload(
    id: string,
    user: { id: string; role: string; organizationId: string | null },
    dto: StartDepotUnloadDto,
  ) {
    const orgId = user.organizationId;
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;

    const idempotencyTable = 'start_depot_unload';
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

    this.validateTransition(from, 'START_DEPOT_UNLOAD');

    const { destinationId, adopted, locationUnverified } = await this.resolveDepotAction(
      trip,
      user,
      { locationUnverified: dto.locationUnverified },
    );

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      const updated = (await tx.execute(
        sql`UPDATE trips AS t SET
              status = ${TripStatus.delivering},
              arrival_at = COALESCE(t.arrival_at, NOW()),
              gps_distance_km = COALESCE(t.gps_distance_km, ${this.gpsDistanceKmExpr()}),
              destination_id = ${destinationId}::uuid,
              depot_operator_id = ${user.id},
              depot_unload_started_at = NOW(),
              depot_confirm_location_unverified = ${locationUnverified},
              updated_at = NOW()
            WHERE t.id = ${id} AND t.status = ${from} RETURNING *`,
      )) as unknown as Record<string, unknown>[];
      if (!updated.length) {
        throw new BadRequestException('Trip status changed concurrently');
      }
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

    this.logTripFlow(id, 'START_DEPOT_UNLOAD', from, TripStatus.delivering);
    if (adopted) {
      this.winston.log('flow', `Depot ${destinationId} adopted unlinked trip ${id}`, {
        context: 'TripsService',
        tripId: id,
        destinationId,
      });
    }
    void this.pushToDriver(id, 'push.depotUnloadStarted', undefined, 'trip_depot_unload_started');
    if (locationUnverified) {
      await this.raiseDepotOverrideAlert(id, trip, orgId);
    }
    return result;
  }

  /**
   * Step 2 — depot-operator delivery confirmation (driver → operator depozit). A
   * depot_manager assigned to the trip's destination depot confirms the arriving
   * bale count, optionally with gross/tare weights, signs with their specimen,
   * and this single action drives the trip arrived/delivering → delivered →
   * completed in one transaction (the operator's signature is stored as the
   * receiver signature). Weighing is optional everywhere — the bale count is the
   * only required measurement. Idempotent on `idempotencyKey`.
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

    const { destinationId, adopted, locationUnverified } = await this.resolveDepotAction(
      trip,
      user,
      { locationUnverified: dto.locationUnverified },
    );

    /*
     * Weighing is optional everywhere.
     *
     * A `principal` depot used to REQUIRE a gross weight unless the operator
     * ticked "cântarul nu merge", which made a scale the gate on the one action
     * that closes a trip: a busy weighbridge, a trailer that won't fit, or a load
     * nobody intends to weigh all left the operator stuck with `gross_weight_required`
     * on a truck he had already emptied. The bale count is the measurement that
     * matters; `scale_broken` now simply records "no weight was taken here".
     *
     * When a weight IS supplied it is still validated: tare above gross is
     * rejected, never silently clamped, because a clamp writes net = 0 onto a
     * legally binding CMR.
     */
    const hasGross = typeof dto.grossWeightKg === 'number' && dto.grossWeightKg > 0;
    const grossWeightKg = hasGross ? (dto.grossWeightKg as number) : null;
    const tareWeightKg = hasGross
      ? typeof dto.tareWeightKg === 'number'
        ? dto.tareWeightKg
        : 0
      : null;
    if (grossWeightKg !== null && tareWeightKg !== null && tareWeightKg > grossWeightKg) {
      throw new BadRequestException({
        error: 'tare_exceeds_gross',
        message: 'Tara nu poate depăși greutatea brută.',
        grossWeightKg,
        tareWeightKg,
      });
    }
    // No weight recorded ⇒ the trip carries the count-only marker, whether the
    // operator pressed "Fără cântărire" or simply left the fields empty.
    const scaleBroken = dto.scaleBroken === true || !hasGross;

    // The operator is the receiver — their name + signature fill the receiver
    // fields so the completed CMR is signed.
    const opRows = (await this.drizzleProvider.db.execute(
      sql`SELECT full_name FROM users WHERE id = ${user.id}::uuid LIMIT 1`,
    )) as unknown as { full_name: string | null }[];
    const operatorName = opRows[0]?.full_name ?? 'Operator depozit';

    // The depot operator's signature is ALWAYS their pre-registered specimen —
    // never trust/require a fresh client draw, see resolveSpecimenSignature.
    const resolvedDepotOperatorSignature = await this.resolveSpecimenSignature(
      user.id,
      dto.depotOperatorSignature,
    );

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      const updated = (await tx.execute(
        sql`UPDATE trips AS t SET
          status = ${TripStatus.completed},
          bale_count = ${dto.baleCount},
          gross_weight_kg = ${grossWeightKg},
          tare_weight_kg = ${tareWeightKg},
          scale_broken = ${scaleBroken},
          -- Stamped on the driver's behalf when the operator closes a truck whose
          -- driver never pressed "Am ajuns"; COALESCE keeps a real arrival intact.
          arrival_at = COALESCE(t.arrival_at, NOW()),
          gps_distance_km = COALESCE(t.gps_distance_km, ${this.gpsDistanceKmExpr()}),
          destination_id = ${destinationId}::uuid,
          delivered_at = NOW(),
          depot_operator_id = ${user.id},
          depot_confirmed_at = NOW(),
          depot_confirm_location_unverified = ${locationUnverified},
          depot_operator_signature_url = ${resolvedDepotOperatorSignature},
          receiver_name = ${operatorName},
          receiver_signature_url = ${resolvedDepotOperatorSignature},
          receiver_signed_at = NOW(),
          completed_at = NOW(),
          updated_at = NOW()
        WHERE t.id = ${id} AND t.status = ${from} RETURNING *`,
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
    if (adopted) {
      this.winston.log('flow', `Depot ${destinationId} adopted unlinked trip ${id}`, {
        context: 'TripsService',
        tripId: id,
        destinationId,
      });
    }
    void this.pushToDriver(id, 'push.depotConfirmed', undefined, 'trip_depot_confirmed');
    if (locationUnverified) {
      await this.raiseDepotOverrideAlert(id, trip, orgId);
    }

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
   *
   * TWO CORRECTIONS LAND HERE TOGETHER, and they are related:
   *
   *   * `parcel_bale_adjustments` now counts. It always did in
   *     ParcelsService.getBaleAvailability but never here, so the two gates on
   *     the same physical question could disagree — by 800 bales across 6 rows
   *     in production at the time of writing. An admin correction that made a
   *     field loadable on the loader's screen still blocked the next iteration.
   *   * The season window. Which needs the adjustments term to be safe: an
   *     admin carrying leftover bales into a new season records them as a
   *     signed delta, and a gate that ignores deltas would keep refusing.
   *
   * The season is resolved inside `parcelBaleTally`, not passed in — see the
   * note there. An organization that has never closed a season resolves to no
   * window and is unaffected by any of this.
   */
  private async computeRemainingBalesOnParcel(
    parcelId: string,
    orgId: string | null,
    executor?: Pick<DrizzleProvider['db'], 'execute'>,
  ): Promise<number> {
    const { remaining } = await this.parcelBaleTally(parcelId, orgId, executor);
    return remaining;
  }

  /**
   * The full produced / loaded / remaining breakdown behind every bale gate.
   *
   * Exists so `registerLoad`'s rejection payload reports the same three numbers
   * the decision was made on. Previously it ran its own query that counted
   * neither adjustments nor seasons, so the error told the operator a different
   * story from the one the gate acted on.
   */
  private async parcelBaleTally(
    parcelId: string,
    orgId: string | null,
    executor?: Pick<DrizzleProvider['db'], 'execute'>,
  ): Promise<{ produced: number; loaded: number; remaining: number }> {
    const db = executor ?? this.drizzleProvider.db;
    // Resolved HERE rather than accepted as a parameter. As a trailing optional
    // argument it was passed at exactly one of the five call sites that ask this
    // question; the other four silently kept the all-time window, so two gates
    // deciding the same physical thing could disagree. A value the method looks
    // up itself cannot be forgotten by a caller.
    //
    // Always the ACTIVE season, never one a user picked: this decides whether a
    // loader in a field may load, and no dropdown may influence that.
    const seasonYear = await this.seasons.getActiveSeasonYear(orgId);
    const org = orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``;
    const window = seasonYear === undefined ? undefined : seasonWindow(seasonYear);
    const producedWin = dateWindowClause(sql`production_date`, window);
    const loadedWin = tsWindowClause(sql`loaded_at`, window);
    const adjWin = tsWindowClause(sql`created_at`, window);
    const rows = (await db.execute(sql`
      SELECT
        (COALESCE((SELECT SUM(bale_count) FROM bale_productions
                  WHERE parcel_id = ${parcelId} AND deleted_at IS NULL ${org}${producedWin}), 0)
         + COALESCE((SELECT SUM(delta) FROM parcel_bale_adjustments
                  WHERE parcel_id = ${parcelId} AND kind = 'produced' AND deleted_at IS NULL ${org}${adjWin}), 0))::int AS produced,
        (COALESCE((SELECT SUM(bale_count) FROM bale_loads
                  WHERE parcel_id = ${parcelId} AND deleted_at IS NULL ${org}${loadedWin}), 0)
         + COALESCE((SELECT SUM(delta) FROM parcel_bale_adjustments
                  WHERE parcel_id = ${parcelId} AND kind = 'loaded' AND deleted_at IS NULL ${org}${adjWin}), 0))::int AS loaded
    `)) as unknown as { produced: number; loaded: number }[];
    const produced = Number(rows[0]?.produced ?? 0);
    const loaded = Number(rows[0]?.loaded ?? 0);
    return { produced, loaded, remaining: Math.max(0, produced - loaded) };
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
               destination_id,
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
          destination_id, destination_name, destination_address,
          destination_coords,
          bale_count,
          parent_trip_id, iteration_index
        ) VALUES (
          ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
          ${tripNumber}, ${TripStatus.planned}::trip_status,
          ${sourceParcelId}, true,
          ${t.truck_id}, ${t.driver_id},
          ${t.loader_id}, ${t.loader_operator_id},
          ${t.destination_id ? sql`${t.destination_id as string}::uuid` : sql`NULL`},
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
          'push.tripNextIteration',
          { iterationIndex },
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
  /**
   * Admin status override — now carrying the load the override implies.
   *
   * This used to move ONLY the status. Forcing a trip to `loaded` therefore left a
   * PHANTOM: it looked loaded, `bale_count` stayed 0, no source was recorded, no
   * `bale_loads` row existed, and so it moved no stock whatsoever. Four such trips
   * exist in production.
   *
   * So when the target status means the goods have been picked up, and the trip has
   * no load recorded, the admin must now say WHERE the load came from and HOW MUCH
   * — and that is written as a real `bale_loads` row, in the same transaction as the
   * status change.
   *
   * That row IS the stock deduction: parcel stock is DERIVED, never stored
   * (`SUM(bale_productions) − SUM(bale_loads)`, see computeRemainingBalesOnParcel and
   * ParcelsService.getBaleAvailability). Nothing needs to "subtract" anything.
   *
   * If the loader already registered a real load, nothing is asked and nothing is
   * inserted — the override just moves the status, as before.
   */
  async forceStatus(id: string, orgId: string | null, dto: ForceStatusDto, callerId?: string) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    const target = dto.status;

    // Statuses that assert "the goods are on the truck". Reaching one of these with
    // no load recorded is what produced the phantom trips.
    const IMPLIES_LOADED: TripStatus[] = [
      TripStatus.loaded,
      TripStatus.in_transit,
      TripStatus.arrived,
      TripStatus.delivering,
      TripStatus.delivered,
      TripStatus.completed,
    ];

    const existingLoads = (await this.drizzleProvider.db.execute(
      sql`SELECT 1 FROM bale_loads
           WHERE trip_id = ${id}::uuid AND deleted_at IS NULL
           LIMIT 1`,
    )) as unknown as unknown[];
    const hasLoad = existingLoads.length > 0;
    const wantsLoad = dto.baleCount !== undefined;

    if (IMPLIES_LOADED.includes(target) && !hasLoad && !wantsLoad) {
      throw new BadRequestException({
        error: 'load_required',
        message:
          'Cursa nu are nicio încărcare înregistrată. Alege de unde vine marfa (parcelă sau depozit) și câți baloți.',
      });
    }

    // Force-completing an auxiliary trip that never received its arrival CMR is
    // a deliberate override of the whole point of gating `completed` on that
    // upload (see completeAuxiliaryOnArrivalCmr) — so require an explicit
    // reason, giving the audit trail (logged below) something to say about why
    // this one didn't go through the normal path.
    if (
      trip.is_auxiliary === true &&
      target === TripStatus.completed &&
      from !== TripStatus.completed &&
      !trip.public_sign_token_used_at &&
      !dto.reason?.trim()
    ) {
      throw new BadRequestException({
        error: 'arrival_cmr_reason_required',
        message:
          'Această cursă auxiliară nu are CMR-ul de sosire încărcat. Specifică un motiv pentru a o finaliza manual.',
      });
    }

    // Validate the source belongs to the caller's org before touching anything —
    // same ownership checks registerLoad performs.
    if (wantsLoad && orgId !== null) {
      if (dto.sourceDepotId) {
        const rows = (await this.drizzleProvider.db.execute(
          sql`SELECT 1 FROM delivery_destinations
               WHERE id = ${dto.sourceDepotId}::uuid AND organization_id = ${orgId}::uuid
                 AND deleted_at IS NULL LIMIT 1`,
        )) as unknown as unknown[];
        if (!rows.length) throw new BadRequestException('Depozit invalid.');
      } else if (dto.parcelId) {
        const rows = (await this.drizzleProvider.db.execute(
          sql`SELECT 1 FROM parcels
               WHERE id = ${dto.parcelId}::uuid AND organization_id = ${orgId}::uuid
                 AND deleted_at IS NULL LIMIT 1`,
        )) as unknown as unknown[];
        if (!rows.length) throw new BadRequestException('Parcelă invalidă.');
      }
    }

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

    if (wantsLoad) {
      /*
       * Stamp the SOURCE ON THE TRIP as well as on the bale_load. This is
       * load-bearing, not belt-and-braces: the reports and the dashboard compute
       * "loaded" by joining bale_loads on `trips.source_parcel_id`
       * (reports.service.ts, dashboard.service.ts) — NOT on `bale_loads.parcel_id`,
       * which is what parcel *remaining* uses. Insert the bale_load without also
       * stamping the trip and remaining moves while the reports do not: a
       * split-brain worse than the phantom trips this is fixing.
       *
       * COALESCE so a real load already on the trip is never overwritten.
       */
      if (dto.parcelId) {
        setClauses.push(sql`source_parcel_id = COALESCE(source_parcel_id, ${dto.parcelId}::uuid)`);
        setClauses.push(sql`source_parcel_auto = false`);
      } else if (dto.sourceDepotId) {
        setClauses.push(
          sql`source_depot_id = COALESCE(source_depot_id, ${dto.sourceDepotId}::uuid)`,
        );
      }
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

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      if (wantsLoad) {
        // Same shape registerLoad inserts (see registerLoad's bale_loads INSERT) —
        // the id doubles as the idempotency key, so a retried override cannot
        // double-count the bales.
        await tx.execute(
          sql`INSERT INTO bale_loads (
                organization_id, id, trip_id, parcel_id, source_depot_id,
                loader_id, operator_id, bale_count, loaded_at, notes
              ) VALUES (
                ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
                ${dto.idempotencyKey ? sql`${dto.idempotencyKey}::uuid` : sql`uuid_generate_v4()`},
                ${id}::uuid,
                ${dto.parcelId ? sql`${dto.parcelId}::uuid` : sql`NULL`},
                ${dto.sourceDepotId ? sql`${dto.sourceDepotId}::uuid` : sql`NULL`},
                ${trip.loader_id ?? null},
                ${callerId ?? null},
                ${dto.baleCount},
                NOW(),
                ${'Încărcare înregistrată manual de admin (forțare stare)'}
              )
              ON CONFLICT (id) DO NOTHING`,
        );
      }

      const updated = await tx.execute(
        sql`UPDATE trips SET ${setClause} WHERE id = ${id}${orgFilter}${expectedFilter} RETURNING *`,
      );
      if (!(updated as unknown as unknown[]).length) return updated;

      if (wantsLoad) {
        // Recompute from the ledger rather than adding a delta — the same thing
        // registerLoad does, and it stays correct if several loads exist.
        await tx.execute(
          sql`UPDATE trips SET
                bale_count = (SELECT COALESCE(SUM(bale_count), 0) FROM bale_loads
                               WHERE trip_id = ${id}::uuid AND deleted_at IS NULL),
                updated_at = NOW()
              WHERE id = ${id}::uuid`,
        );
      }
      return updated;
    });

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
      baleCount: dto.baleCount ?? null,
      parcelId: dto.parcelId ?? null,
      sourceDepotId: dto.sourceDepotId ?? null,
    });

    // Auxiliary force-load: an admin forcing an aux trip to `loaded` should behave
    // like a mobile register-load — fire the loaded side-effects once (idempotent:
    // mints the sign token, retires the truck, queues stage-1 CMR, SMSs the
    // arrival-CMR link). The trip then waits for that upload like any other aux
    // trip — there is no timer to schedule anymore.
    if (trip.is_auxiliary === true && target === TripStatus.loaded) {
      await this.applyAuxiliaryLoadedSideEffects(id, orgId);
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
    void this.pushToDriver(id, 'push.tripDisputed', undefined, 'trip_disputed');
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
          // destination_id comes straight from the task — this method already
          // returns early unless `task.destination_id` is set, so it is always
          // available here. Migration 00051 added trips.destination_id explicitly
          // to MIRROR task_assignments.destination_id (00018); the mirror was just
          // never wired up.
          sql`INSERT INTO trips (
            organization_id,
            trip_number, status, source_parcel_id, truck_id, driver_id,
            loader_id, loader_operator_id,
            destination_id, destination_name, destination_address, destination_coords,
            bale_count, source_parcel_auto
          ) VALUES (
            ${taskOrgId ? sql`${taskOrgId}::uuid` : sql`NULL`},
            ${tripNumber}, ${TripStatus.planned}, ${sourceParcelId},
            ${task.machine_id}, ${driverId},
            ${loaderMachineId}, ${loaderOperatorId},
            ${task.destination_id}::uuid, ${dest.name}, ${dest.address ?? null},
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
    // `deleted_at IS NULL` matters: without it a soft-deleted trip still reports
    // status 'planned', so this took the UPDATE branch on a corpse and never minted
    // a replacement. Now a deleted trip reads as absent and the caller falls
    // through to the INSERT path.
    const statusRows = (await this.drizzleProvider.db.execute(
      sql`SELECT status FROM trips WHERE id = ${task.trip_id} AND deleted_at IS NULL LIMIT 1`,
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
      // Re-planning a still-`planned` trip must move destination_id too, or the FK
      // would keep pointing at the depot the dispatcher just changed away from.
      sql`UPDATE trips SET
        source_parcel_id = ${sourceParcelId},
        truck_id = ${task.machine_id},
        driver_id = ${driverId},
        loader_id = ${loaderMachineId},
        loader_operator_id = ${loaderOperatorId},
        destination_id = ${task.destination_id}::uuid,
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
      sql`SELECT id, machine_id, parcel_id, destination_id, assigned_user_id
          FROM task_assignments
          WHERE id = ${parentAssignmentId} AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as {
      id: string;
      machine_id: string;
      parcel_id: string | null;
      destination_id: string | null;
      assigned_user_id: string | null;
    }[];
    const parent = parentRows[0];
    if (!parent) return;

    // The loader can be working a field OR a depot (00073_loader_depot_source) —
    // without this, a depot-assigned loader minted an aux trip with NO pickup
    // source at all, since only parcel_id was ever read here.
    const sourceParcelId = parent.parcel_id;
    const sourceDepotId = parent.parcel_id ? null : parent.destination_id;
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

    // Shared with `updateAuxRequest`'s edit cascade — two writers, one ladder,
    // or the loader's phone and the admin table describe different destinations.
    const destName = auxTripDestinationName({
      destinationLocality: req.destination_locality,
      companyName: req.company_name,
    });
    const destAddress = req.destination_address ?? null;

    /*
     * ADOPT an existing trip instead of minting a second one.
     *
     * `tripId` comes from the TASK (`task_assignments.trip_id`), and a NEW task always
     * has it NULL — so `if (!tripId)` used to mint a fresh trip every time. But
     * re-planning a transport to another day IS a new task, while the request and its
     * one-time truck are the SAME. The result: every re-plan silently duplicated the
     * trip on the same request.
     *
     * That is exactly how Microfruit ended up with two: planned for 08.07, re-planned
     * for 09.07, and the second task minted TR-20260709-001 alongside the still-live
     * TR-20260708-003. Ten requests currently have a live trip and would each duplicate
     * on the next re-plan.
     *
     * The identity of an auxiliary transport is the REQUEST, not the task — one
     * request, one one-time truck, one trip. So if the request already carries a trip
     * that has not been executed yet (planned/loading — never a loaded/completed one,
     * whose bales and CMR are real history), the new task adopts it and the UPDATE path
     * below simply moves it. Only a request with no live trip mints one.
     */
    let effectiveTripId = tripId;
    if (!effectiveTripId) {
      const adoptable = (await this.drizzleProvider.db.execute(
        sql`SELECT id FROM trips
             WHERE trip_request_id = ${req.id}::uuid
               AND deleted_at IS NULL
               AND status IN (${TripStatus.planned}::trip_status, ${TripStatus.loading}::trip_status)
             ORDER BY created_at DESC
             LIMIT 1`,
      )) as unknown as { id: string }[];
      const adopted = adoptable[0]?.id;
      if (adopted) {
        // Hand the trip to the new task, and detach it from the old one so the trip
        // is never claimed by two tasks at once.
        await this.drizzleProvider.db.execute(
          sql`UPDATE task_assignments SET trip_id = NULL, updated_at = NOW()
               WHERE trip_id = ${adopted}::uuid AND id <> ${taskId} AND deleted_at IS NULL`,
        );
        await this.drizzleProvider.db.execute(
          sql`UPDATE task_assignments SET trip_id = ${adopted}::uuid, updated_at = NOW()
               WHERE id = ${taskId}`,
        );
        this.winston.log(
          'flow',
          `Aux re-plan: task ${taskId} adopted existing trip ${adopted} (request ${req.id}) instead of minting a duplicate`,
          { context: 'TripsService', taskId, tripId: adopted, requestId: req.id },
        );
        effectiveTripId = adopted;
      }
    }

    if (!effectiveTripId) {
      const orgId = organizationId ?? null;
      const newTripId = await this.drizzleProvider.db.transaction(async (tx) => {
        const tripNumber = await this.generateTripNumber(orgId, tx);
        const inserted = (await tx.execute(
          sql`INSERT INTO trips (
                organization_id,
                trip_number, status, source_parcel_id, source_depot_id, truck_id, driver_id,
                loader_id, loader_operator_id,
                destination_name, destination_address, destination_coords,
                bale_count, source_parcel_auto,
                is_auxiliary, external_driver_name, external_driver_phone,
                external_driver_email, trip_request_id
              ) VALUES (
                ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
                ${tripNumber}, ${TripStatus.planned}, ${sourceParcelId}, ${sourceDepotId},
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
        sourceDepotId,
        cropType: req.crop_type,
        tripId: newTripId,
        orgId,
      });
      return;
    }

    // UPDATE path — only while still planned (don't reshape an in-progress trip).
    // Runs for the task's own trip AND for a trip just adopted from a re-plan, which
    // is the whole point: the adopted trip is MOVED to the new day/loader rather than
    // a second one being minted alongside it.
    //
    // `deleted_at IS NULL`: a soft-deleted aux trip must read as absent, not as a
    // live `planned` one, or re-planning a deleted transport silently updates the
    // corpse instead of creating a fresh trip.
    const statusRows = (await this.drizzleProvider.db.execute(
      sql`SELECT status FROM trips WHERE id = ${effectiveTripId} AND deleted_at IS NULL LIMIT 1`,
    )) as unknown as { status: string }[];
    if (statusRows[0]?.status !== TripStatus.planned) return;

    await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            source_parcel_id = ${sourceParcelId},
            source_depot_id = ${sourceDepotId},
            loader_id = ${loaderMachineId},
            loader_operator_id = ${loaderOperatorId},
            destination_name = ${destName},
            destination_address = ${destAddress},
            updated_at = NOW()
          WHERE id = ${effectiveTripId} AND status = ${TripStatus.planned}`,
    );

    // Keep the request's pointer on the trip that actually exists. It is
    // last-write-wins and was only ever set at mint time, so after a re-plan it could
    // dangle at a trip that had since been cancelled — which is how one request came
    // to display a CANCELLED trip while its live planned one sat hidden behind it.
    await this.drizzleProvider.db.execute(
      sql`UPDATE trip_requests SET trip_id = ${effectiveTripId}::uuid, updated_at = NOW()
           WHERE id = ${req.id}::uuid AND trip_id IS DISTINCT FROM ${effectiveTripId}::uuid`,
    );
  }

  /** SMS the external driver their pickup details + loader phone (stubbed). */
  private async sendDriverAssignedSms(args: {
    driverPhone: string | null;
    loaderOperatorId: string | null;
    sourceParcelId: string | null;
    sourceDepotId?: string | null;
    cropType: string | null;
    tripId: string;
    orgId: string | null;
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
      } else if (args.sourceDepotId) {
        const d = (await this.drizzleProvider.db.execute(
          sql`SELECT name, address,
                     ST_Y(coords) AS lat,
                     ST_X(coords) AS lon
              FROM delivery_destinations WHERE id = ${args.sourceDepotId}::uuid LIMIT 1`,
        )) as unknown as {
          name: string;
          address: string | null;
          lat: number | null;
          lon: number | null;
        }[];
        parcelName = d[0]?.name ?? null;
        locality = d[0]?.address ?? null;
        mapsUrl = fmtCoordsUrl(d[0]?.lat, d[0]?.lon);
      }
      // Locale: this SMS goes to the auxiliary trip's external driver
      // (`sendDriverAssignedSms`, "SMS the external driver..." above) —
      // sourced from trip_requests.driver_phone, a free-text field with no
      // linked `users` row and therefore no locale preference to read.
      const tpl = messageTemplates[MessageKind.driver_assigned][DEFAULT_LOCALE]({
        loaderName,
        loaderPhone,
        parcelName,
        isDepotSource: !args.sourceParcelId && !!args.sourceDepotId,
        locality,
        mapsUrl,
        cropType: args.cropType,
      });
      await this.messaging.sendSms({
        to: args.driverPhone,
        body: tpl.body,
        kind: MessageKind.driver_assigned,
        // See the note on the arrival-CMR SMS: the gate needs the org here.
        metadata: { tripId: args.tripId, orgId: args.orgId },
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
   * Resolve the organization behind a one-time public trip token and assert the
   * feature is on.
   *
   * Silent no-op when the token matches nothing: the caller already produces
   * its own deliberately non-leaky "invalid or used" error, and answering
   * differently here would turn this into a token oracle.
   */
  private async assertPublicTokenFeature(token: string, feature: FeatureKey): Promise<void> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT organization_id FROM trips
          WHERE public_sign_token = ${token} AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as { organization_id: string | null }[];
    const orgId = rows[0]?.organization_id;
    if (orgId) await this.features.assertEnabledForOrg(orgId, feature);
  }

  /**
   * DEPRECATED — kept for one release only, for drivers who already received
   * an old-style "sign the CMR" SMS link before this deploy. The admin-web
   * `/sign/[token]` page now redirects to `/cmr/[token]` for everyone, so this
   * is only reachable by a stale bookmark or a direct API call.
   *
   * Stores the driver's signature (the "last signature") and finalizes
   * stage-2 of the CMR — same as before. The one change: it now ALSO
   * completes the trip itself, because the 5-minute auto-complete timer that
   * used to do that is gone. Without this, a legacy link would set
   * `public_sign_token_used_at` (burning the one-time token) and then leave
   * the trip stuck in `loaded` forever, since nothing else would ever
   * complete it. One-time per token, same guarantee as before.
   */
  async signByPublicToken(token: string, signature: string): Promise<{ ok: true }> {
    /*
     * Gate BEFORE the UPDATE. This is a @Public() route, so FeaturesGuard sees
     * no request.user and the org is only knowable from the token. It also
     * cannot be checked afterwards: the UPDATE both stores the signature and
     * BURNS the one-time token, so a late rejection would leave the link spent
     * and the trip unsigned — unrecoverable.
     */
    await this.assertPublicTokenFeature(token, 'documents.public_sign');

    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trips SET
            driver_signature_url = ${signature},
            public_sign_token_used_at = NOW(),
            updated_at = NOW()
          WHERE public_sign_token = ${token}
            AND is_auxiliary = true
            AND deleted_at IS NULL
            AND public_sign_token_used_at IS NULL
          RETURNING id, organization_id, status`,
    )) as unknown as { id: string; organization_id: string | null; status: TripStatus }[];
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

    // Separately guarded on `status = loaded`, so signing a trip that is
    // already `completed` (harmless) or `cancelled` (must NOT be resurrected)
    // touches nothing beyond the signature recorded above.
    if (row.status === TripStatus.loaded) {
      await this.drizzleProvider.db.execute(
        sql`UPDATE trips SET
              status = ${TripStatus.completed}::trip_status,
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
            WHERE id = ${row.id} AND status = ${TripStatus.loaded}::trip_status`,
      );
    }
    this.logTripFlow(row.id, 'AUX_DRIVER_SIGNED', row.status, TripStatus.completed);
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
   * Daily sweep — auto-cancel own-fleet planned trips whose planned day has
   * already passed and that were never started.
   *
   * WHY THIS EXISTS: the sync pull force-includes every non-terminal trip on
   * every pull (sync.service `versionFilter`: `status NOT IN
   * ('completed','cancelled')`), scoped to `driver_id`/`loader_operator_id`. A
   * `planned` trip never reaches a terminal status on its own, so an abandoned
   * plan stays glued to the phone day after day — exactly the "a DJ keeps
   * showing up" ghost. Nothing ever cancelled it; this job does.
   *
   * Scope is deliberately narrow (decided with the operator):
   *   - own-fleet only (`is_auxiliary = false`) — auxiliary/external pickups may
   *     legitimately wait days for the external truck, so they are left alone;
   *   - "planned day passed" = the latest live task-assignment date for the trip
   *     (fallback: the trip's creation date in Romania tz) is strictly before
   *     today in Europe/Bucharest — so a plan created today for tomorrow, or one
   *     dispatched for a future day, survives until its own day has elapsed.
   *
   * Each cancelled trip also has its still-live task_assignments soft-deleted so
   * the truck drops off the tasks board (both the boot backfill and
   * `autoUpsertFromTruckTask` filter `deleted_at IS NULL`, so nothing
   * resurrects them). Cancelling bumps `sync_version` via trigger, so the phone
   * pulls the terminal row and the ghost disappears on the next sync.
   */
  async sweepStalePlannedTrips(): Promise<{ cancelled: number; tasksRemoved: number }> {
    const today = todayInRomania();
    const rows = (await this.drizzleProvider.db.execute(sql`
      WITH stale AS (
        SELECT t.id
          FROM trips t
         WHERE t.status = ${TripStatus.planned}
           AND t.deleted_at IS NULL
           AND t.is_auxiliary = false
           AND COALESCE(
                 (SELECT MAX(ta.assignment_date) FROM task_assignments ta
                   WHERE ta.trip_id = t.id AND ta.deleted_at IS NULL),
                 (t.created_at AT TIME ZONE 'Europe/Bucharest')::date
               ) < ${today}::date
      ),
      cancelled AS (
        UPDATE trips SET
          status = ${TripStatus.cancelled},
          cancelled_at = NOW(),
          cancellation_reason = 'Auto-anulat: plan neînceput, ziua planificată a trecut',
          updated_at = NOW()
        WHERE id IN (SELECT id FROM stale) AND status = ${TripStatus.planned}
        RETURNING id
      ),
      tasks AS (
        UPDATE task_assignments SET deleted_at = NOW(), updated_at = NOW()
        WHERE trip_id IN (SELECT id FROM cancelled) AND deleted_at IS NULL
        RETURNING id
      )
      SELECT
        (SELECT COALESCE(json_agg(id), '[]'::json) FROM cancelled) AS cancelled_ids,
        (SELECT COUNT(*)::int FROM tasks) AS tasks_removed
    `)) as unknown as { cancelled_ids: string[]; tasks_removed: number }[];

    const cancelledIds = rows[0]?.cancelled_ids ?? [];
    const tasksRemoved = Number(rows[0]?.tasks_removed ?? 0);

    for (const id of cancelledIds) {
      this.logTripFlow(id, 'AUTO_CANCEL_STALE_PLAN', TripStatus.planned, TripStatus.cancelled);
    }
    if (cancelledIds.length > 0) {
      this.winston.log(
        'flow',
        `Stale-plan sweep: cancelled ${cancelledIds.length} own-fleet planned trip(s), removed ${tasksRemoved} task assignment(s)`,
        { context: 'TripsService', cancelled: cancelledIds.length, tasksRemoved },
      );
    }
    return { cancelled: cancelledIds.length, tasksRemoved };
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
   * AUXILIARY TRIPS ARE DIFFERENT: deleting one UN-PLANS the transport.
   *
   * An aux trip is owned by its `trip_request` — it is the execution of a
   * commitment that still exists. Deleting only the trip row (the own-fleet
   * behaviour) used to STRAND the request: `trip_requests.trip_id` kept pointing
   * at a dead trip, the truck task kept its `trip_id`, so `autoUpsertAuxiliaryTrip`
   * took its UPDATE branch on a corpse and never minted a replacement. The
   * loader's phone then read "Camionul auxiliar nu are o cursă activă" forever and
   * re-assigning the loader did nothing.
   *
   * So for an aux trip the delete is transactional and does three things:
   *   1. soft-delete the trip
   *   2. soft-delete the originating truck task (the plan died with the truck)
   *   3. clear `trip_requests.trip_id`
   * The request drops back to "Confirmată — neplanificată" and the dispatcher can
   * simply re-assign it on the truck board — which is exactly what you want when a
   * truck breaks down. The auxiliary machine is untouched (it is only retired at
   * load time), so the same truck can be re-planned if it is fixed.
   *
   * This does NOT weaken the invariant above: we soft-delete the task rather than
   * NULL-ing its `trip_id`, and both the boot backfill and autoUpsert filter
   * `ta.deleted_at IS NULL`, so nothing resurrects it. Own-fleet deletes are
   * completely unchanged.
   *
   * Idempotent: if the trip is already soft-deleted, throws 404.
   *
   * Dispatchers can only delete trips in pre-execution statuses; admins may
   * delete a trip in any status (including completed/disputed) for cleanup.
   */
  async softDelete(id: string, orgId: string | null, userRole: UserRole) {
    const trip = await this.findById(id, orgId);
    const from = trip.status as TripStatus;
    const isAuxiliary = trip.is_auxiliary === true;

    if (userRole !== 'admin') {
      const deletableStatuses = ['planned', 'loading', 'loaded', 'cancelled'];
      if (!deletableStatuses.includes(from)) {
        throw new BadRequestException(
          `Tripul cu status "${from}" nu poate fi șters. Anulați-l mai întâi.`,
        );
      }
    }

    // NOTE: for OWN-FLEET trips we intentionally do NOT clear
    // task_assignments.trip_id — see the doc comment above. Detaching it would let
    // onModuleInit / autoUpsert resurrect the trip on the next backend boot.
    // Fold the org filter into the UPDATE (not just the prior findById) so the
    // write is atomically scoped to the caller's org, matching forceStatus and
    // every other mutation in this file.
    const orgFilter = orgId !== null ? sql` AND organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.transaction(async (tx) => {
      const deleted = await tx.execute(
        sql`UPDATE trips SET deleted_at = NOW(), updated_at = NOW()
             WHERE id = ${id} AND deleted_at IS NULL${orgFilter}
         RETURNING id`,
      );
      if (!(deleted as unknown as unknown[]).length) return deleted;

      if (isAuxiliary) {
        // The plan died with the truck. Soft-delete the task (NOT null its
        // trip_id) so neither the boot backfill nor autoUpsert can revive it.
        await tx.execute(
          sql`UPDATE task_assignments SET deleted_at = NOW(), updated_at = NOW()
               WHERE trip_id = ${id}::uuid AND deleted_at IS NULL`,
        );
        // Hand the request back to the dispatcher as "confirmed, unplanned".
        await tx.execute(
          sql`UPDATE trip_requests SET trip_id = NULL, updated_at = NOW()
               WHERE trip_id = ${id}::uuid AND deleted_at IS NULL`,
        );
      }
      return deleted;
    });

    this.logTripFlow(id, isAuxiliary ? 'DELETE_AUX_UNPLAN' : 'DELETE', from, 'deleted');
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
