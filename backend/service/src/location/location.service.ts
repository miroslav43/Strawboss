import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ProfileService } from '../profile/profile.service';
import { GeocodeService } from '../geocode/geocode.service';
import { todayInRomania } from '../common/date';
import {
  ACCURACY_CAP_M,
  SEGMENT_CAP_M,
  SLOW_MACHINE_MIN_LEG_M,
  SLOW_MACHINE_SPEED_CAP_MS,
  SPEED_CAP_MS,
  clampAccuracyM,
  clampHeadingDeg,
  clampSpeedMs,
} from '../common/gps-noise';
import { cleanRoutePoints } from '../common/route-cleaning';
import { QUEUE_GEOFENCE_CHECK } from '../jobs/queues';
import type {
  KmByDayResponse,
  LocationReportDto,
  MachineLastLocation,
  RouteHistoryResponse,
  RoutePoint,
} from '@strawboss/types';

/** Tuning knobs for {@link LocationService.getRouteHistory}. */
export interface RouteHistoryOptions {
  /** Return every stored ping untouched — the UI's "raw data" switch. */
  raw?: boolean;
  /** Accuracy ceiling in metres. Defaults to {@link ACCURACY_CAP_M}. */
  maxAccuracyM?: number;
}

/** Hard cap on rows pulled for one track, before filtering. */
const ROUTE_HISTORY_LIMIT = 50_000;

/**
 * Whitelist the client-supplied fix source. `task` = the location foreground
 * service (a real tracking fix); `checkin` = the 60 s presence alarm's
 * best-effort fix (last-known + Balanced — a network position that exists to
 * answer "roughly where", never to draw a track). Anything else — including
 * everything sent by APKs older than vc56 — becomes NULL, which reads as
 * "unknown, treat as task" so historical data keeps rendering.
 */
function normalizeLocationSource(source: unknown): 'task' | 'checkin' | null {
  return source === 'task' || source === 'checkin' ? source : null;
}

@Injectable()
export class LocationService {
  /**
   * Wall-clock of the last geofence-check we nudged. Event-driven geofence is
   * globally throttled to at most once per {@link GEOFENCE_NUDGE_THROTTLE_MS}
   * so a fleet reporting GPS every few seconds cannot flood the queue (one
   * check re-evaluates every machine anyway).
   */
  private lastGeofenceNudgeMs = 0;
  private static readonly GEOFENCE_NUDGE_THROTTLE_MS = 15_000;

  /**
   * Throttle for the "dropping cross-org/stale location report" warning. A single
   * misconfigured phone re-posts a doomed report many times per second, so we log
   * the drop at most once per window to keep it diagnosable without flooding.
   */
  private lastDropLogMs = 0;
  private static readonly DROP_LOG_THROTTLE_MS = 60_000;

  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly profileService: ProfileService,
    private readonly geocodeService: GeocodeService,
    @InjectQueue(QUEUE_GEOFENCE_CHECK) private readonly geofenceQueue: Queue,
  ) {}

  /**
   * Store a single GPS ping from a mobile device.
   * Any authenticated operator can report their position, but only for
   * machines belonging to their own organization.
   */
  async reportLocation(
    dto: LocationReportDto,
    operatorId: string,
    orgId: string | null,
  ): Promise<void> {
    if (dto.lat < -90 || dto.lat > 90 || dto.lon < -180 || dto.lon > 180) {
      throw new BadRequestException('Invalid coordinates');
    }

    // Attribute the ping to the operator's CURRENT assigned machine rather than
    // the machineId the client sent. The mobile app caches its machineId on disk
    // and the background/watchdog/boot-rearm paths read that cache as gospel;
    // after a reassignment (often while the app is backgrounded/frozen, so the
    // React effect that would refresh the cache never runs) the cached machine is
    // stale and later deleted or moved org → an endless "Machine not found" 400
    // storm. The request is authenticated, so the server already knows the
    // operator's real machine — trust it. Fall back to the client's machineId
    // only when the operator has no assignment (legacy behaviour).
    const assignedRows = (await this.drizzleProvider.db.execute(sql`
      SELECT assigned_machine_id AS "assignedMachineId"
      FROM users
      WHERE id = ${operatorId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as { assignedMachineId: string | null }[];
    const assignedMachineId = assignedRows[0]?.assignedMachineId ?? null;
    const machineId = assignedMachineId ?? dto.machineId;

    if (assignedMachineId && dto.machineId !== assignedMachineId) {
      // Surface the stale client cache without failing the report.
      this.logger.debug(
        `Location machineId mismatch for operator ${operatorId}: client sent ` +
          `${dto.machineId}, attributing to assigned ${assignedMachineId}`,
      );
    }

    if (orgId !== null) {
      const machineCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${machineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (machineCheck.length === 0) {
        // Stale/cross-org machine id: the operator has no in-org machine to
        // attribute this ping to. Returning 400 here just makes the mobile outbox
        // re-queue and re-post the same doomed report forever — one misconfigured
        // phone generated >180k such 400s in a single day. Drop it silently (204)
        // and surface the misconfig at most once per minute so it stays
        // diagnosable without flooding the logs.
        const nowMs = Date.now();
        if (nowMs - this.lastDropLogMs > LocationService.DROP_LOG_THROTTLE_MS) {
          this.lastDropLogMs = nowMs;
          this.logger.warn(
            `Dropping location report: machine ${machineId} not in org ${orgId} for ` +
              `operator ${operatorId} (client sent ${dto.machineId}, assigned ` +
              `${assignedMachineId ?? 'none'}) — likely a stale cross-org cached machine id`,
          );
        }
        return;
      }
    }

    await this.drizzleProvider.db.execute(sql`
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms, recorded_at, source)
      VALUES (
        ${machineId}::uuid,
        ${operatorId}::uuid,
        ${dto.lat},
        ${dto.lon},
        ${clampAccuracyM(dto.accuracyM)},
        ${clampHeadingDeg(dto.headingDeg)},
        ${clampSpeedMs(dto.speedMs)},
        ${dto.recordedAt}::timestamptz,
        ${normalizeLocationSource(dto.source)}
      )
      ON CONFLICT DO NOTHING
    `);

    // Presence: a backgrounded operator (screen off) pauses the JS heartbeat,
    // but a machine-bound device keeps streaming GPS via its foreground service.
    // Touch last_seen_at here so such operators stay "online" on the dashboard
    // without a dedicated heartbeat. Best-effort — presence must never fail the
    // location report.
    void this.profileService.touchLastSeen(operatorId).catch((err) => {
      this.logger.warn(
        `touchLastSeen from location report failed for ${operatorId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    });

    // Event-driven geofence: nudge an immediate check shortly after a fresh GPS
    // ping so enter/exit transitions fire in seconds instead of waiting for the
    // 2-min job. Globally throttled to bound queue load (audit #4). Best-effort
    // — a queue error must never fail the location report.
    const now = Date.now();
    if (now - this.lastGeofenceNudgeMs > LocationService.GEOFENCE_NUDGE_THROTTLE_MS) {
      this.lastGeofenceNudgeMs = now;
      void this.geofenceQueue
        .add('check', {}, { removeOnComplete: true, removeOnFail: true })
        .catch(() => {});
    }
  }

  /**
   * Store a batch of GPS pings (1–30) collected while the mobile device was
   * offline (outbox flush). Same attribution/validation rules as
   * reportLocation(), but the per-request lookups it would otherwise repeat
   * once per ping are hoisted to run ONCE for the whole batch:
   *   - the operator's assigned-machine lookup
   *   - the machine org-check
   *   - the presence touch (touchLastSeen)
   *   - the (already-throttled) geofence nudge
   * All pings in one batch come from the same offline window on the same
   * device, so they share one effective machineId — the operator's current
   * assignment if any, otherwise the client-sent id of the first item.
   */
  async reportLocationBatch(
    reports: LocationReportDto[],
    operatorId: string,
    orgId: string | null,
  ): Promise<void> {
    if (!Array.isArray(reports) || reports.length === 0) {
      throw new BadRequestException('reports must be a non-empty array');
    }
    if (reports.length > 30) {
      throw new BadRequestException('reports cannot contain more than 30 items');
    }
    for (const dto of reports) {
      if (dto.lat < -90 || dto.lat > 90 || dto.lon < -180 || dto.lon > 180) {
        throw new BadRequestException('Invalid coordinates');
      }
    }

    // 1x resolve the operator's CURRENT assigned machine — see reportLocation()
    // above for why we trust this over the client-sent machineId.
    const assignedRows = (await this.drizzleProvider.db.execute(sql`
      SELECT assigned_machine_id AS "assignedMachineId"
      FROM users
      WHERE id = ${operatorId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as { assignedMachineId: string | null }[];
    const assignedMachineId = assignedRows[0]?.assignedMachineId ?? null;
    const machineId = assignedMachineId ?? reports[0].machineId;

    if (assignedMachineId && reports.some((r) => r.machineId !== assignedMachineId)) {
      this.logger.debug(
        `Batch location machineId mismatch for operator ${operatorId}: attributing ` +
          `${reports.length} report(s) to assigned ${assignedMachineId}`,
      );
    }

    if (orgId !== null) {
      const machineCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${machineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (machineCheck.length === 0) {
        // Mirrors reportLocation(): drop the whole batch silently (204) rather
        // than throwing a 4xx, so the mobile outbox doesn't spin forever
        // re-posting a permanently cross-org/stale batch. Throttled warn log.
        const nowMs = Date.now();
        if (nowMs - this.lastDropLogMs > LocationService.DROP_LOG_THROTTLE_MS) {
          this.lastDropLogMs = nowMs;
          this.logger.warn(
            `Dropping location batch (${reports.length} report(s)): machine ${machineId} ` +
              `not in org ${orgId} for operator ${operatorId} — likely a stale cross-org cached machine id`,
          );
        }
        return;
      }
    }

    const rows = sql.join(
      reports.map(
        (dto) => sql`(
          ${machineId}::uuid,
          ${operatorId}::uuid,
          ${dto.lat},
          ${dto.lon},
          ${clampAccuracyM(dto.accuracyM)},
          ${clampHeadingDeg(dto.headingDeg)},
          ${clampSpeedMs(dto.speedMs)},
          ${dto.recordedAt}::timestamptz,
          ${normalizeLocationSource(dto.source)}
        )`,
      ),
      sql`, `,
    );

    await this.drizzleProvider.db.execute(sql`
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms, recorded_at, source)
      VALUES ${rows}
      ON CONFLICT DO NOTHING
    `);

    // Presence: once per batch — see reportLocation() for the rationale.
    void this.profileService.touchLastSeen(operatorId).catch((err) => {
      this.logger.warn(
        `touchLastSeen from location batch report failed for ${operatorId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    });

    // Event-driven geofence: once per batch. Globally throttled already, so a
    // burst of small batches still only nudges the queue at most once per
    // GEOFENCE_NUDGE_THROTTLE_MS window.
    const now = Date.now();
    if (now - this.lastGeofenceNudgeMs > LocationService.GEOFENCE_NUDGE_THROTTLE_MS) {
      this.lastGeofenceNudgeMs = now;
      void this.geofenceQueue
        .add('check', {}, { removeOnComplete: true, removeOnFail: true })
        .catch(() => {});
    }
  }

  /**
   * Return the last known position for every machine that has reported GPS,
   * scoped to the caller's organization.
   * Admin-only endpoint.
   */
  async getLastKnownPositions(orgId: string | null): Promise<MachineLastLocation[]> {
    // Reads machine_last_positions (migration 00081) — one row per machine,
    // kept current by an AFTER INSERT trigger on machine_location_events —
    // instead of a full-history `SELECT DISTINCT ON` scan over
    // machine_location_events, which had no time window and degraded as that
    // table grew. No time window here either, by design: a machine parked for
    // weeks must still surface its last known position.
    const orgFilter = orgId !== null ? sql`WHERE m.organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        mlp.machine_id                                        AS "machineId",
        m.machine_type                                        AS "machineType",
        COALESCE(m.internal_code, m.registration_plate)      AS "machineCode",
        mlp.operator_id                                       AS "operatorId",
        u.full_name                                           AS "operatorName",
        au.id                                                 AS "assignedUserId",
        au.full_name                                          AS "assignedUserName",
        mlp.lat::float          AS lat,
        mlp.lon::float          AS lon,
        mlp.accuracy_m::float   AS "accuracyM",
        mlp.heading_deg::float  AS "headingDeg",
        mlp.speed_ms::float     AS "speedMs",
        mlp.recorded_at  AS "recordedAt"
      FROM machine_last_positions mlp
      LEFT JOIN machines m  ON m.id = mlp.machine_id
      LEFT JOIN users    u  ON u.id = mlp.operator_id
      LEFT JOIN users    au ON au.assigned_machine_id = mlp.machine_id
                            AND au.deleted_at IS NULL
      ${orgFilter}
    `);

    const rows = result as unknown as MachineLastLocation[];
    // Best-effort: attach a "nearest locality" label to positions whose GPS is
    // currently fresh, served from the geocode cache. Cache misses stay null and
    // fill asynchronously for the next poll — this never blocks on Nominatim.
    await this.geocodeService.attachLocalities(rows);
    return rows;
  }

  /**
   * Return the last known position of ONE machine, but only if it reported GPS
   * within the last `windowMinutes`. Org-scoped. Used by the driver trip screen
   * to navigate to the trip's loader when it is "live"; returns null when the
   * machine has no recent fix so the caller can fall back to the loading field.
   */
  async getMachineLastLocation(
    machineId: string,
    windowMinutes: number,
    orgId: string | null,
  ): Promise<MachineLastLocation | null> {
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
      throw new BadRequestException('windowMinutes must be an integer between 1 and 60');
    }

    const whereConditions: ReturnType<typeof sql>[] = [
      sql`mle.machine_id = ${machineId}::uuid`,
      sql`mle.recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'`,
    ];
    if (orgId !== null) whereConditions.push(sql`m.organization_id = ${orgId}::uuid`);
    const where = sql.join(whereConditions, sql` AND `);

    const result = (await this.drizzleProvider.db.execute(sql`
      SELECT DISTINCT ON (mle.machine_id)
        mle.machine_id                                        AS "machineId",
        m.machine_type                                        AS "machineType",
        COALESCE(m.internal_code, m.registration_plate)      AS "machineCode",
        mle.operator_id                                       AS "operatorId",
        u.full_name                                           AS "operatorName",
        au.id                                                 AS "assignedUserId",
        au.full_name                                          AS "assignedUserName",
        mle.lat::float          AS lat,
        mle.lon::float          AS lon,
        mle.accuracy_m::float   AS "accuracyM",
        mle.heading_deg::float  AS "headingDeg",
        mle.speed_ms::float     AS "speedMs",
        mle.recorded_at  AS "recordedAt"
      FROM machine_location_events mle
      LEFT JOIN machines m  ON m.id = mle.machine_id
      LEFT JOIN users    u  ON u.id = mle.operator_id
      LEFT JOIN users    au ON au.assigned_machine_id = mle.machine_id
                            AND au.deleted_at IS NULL
      WHERE ${where}
      ORDER BY mle.machine_id, mle.recorded_at DESC
    `)) as unknown as MachineLastLocation[];

    return result[0] ?? null;
  }

  /**
   * Return the last known positions of machines related to a user via
   * today's task assignments. This lets loaders see their trucks, etc.
   */
  async getRelatedMachineLocations(userId: string): Promise<MachineLastLocation[]> {
    const today = todayInRomania();
    const result = await this.drizzleProvider.db.execute(sql`
      WITH my_assignments AS (
        SELECT machine_id FROM task_assignments
        WHERE assigned_user_id = ${userId}::uuid
          AND assignment_date = ${today}
          AND deleted_at IS NULL
      ),
      sibling_machines AS (
        -- All machines sharing the same parent assignment (siblings)
        SELECT DISTINCT ta2.machine_id
        FROM task_assignments ta1
        JOIN task_assignments ta2 ON ta2.parent_assignment_id = ta1.parent_assignment_id
          AND ta2.assignment_date = ${today}
          AND ta2.deleted_at IS NULL
        WHERE ta1.assigned_user_id = ${userId}::uuid
          AND ta1.assignment_date = ${today}
          AND ta1.deleted_at IS NULL
          AND ta1.parent_assignment_id IS NOT NULL
        UNION
        -- Children of my assignments
        SELECT ta3.machine_id
        FROM task_assignments ta3
        JOIN my_assignments ma ON ta3.parent_assignment_id IN (
          SELECT id FROM task_assignments
          WHERE machine_id = ma.machine_id
            AND assignment_date = ${today}
            AND deleted_at IS NULL
        )
        WHERE ta3.assignment_date = ${today}
          AND ta3.deleted_at IS NULL
        UNION
        -- Parent assignment machine (e.g. baler when current user is the truck child)
        SELECT DISTINCT parent.machine_id
        FROM task_assignments me
        JOIN task_assignments parent
          ON parent.id = me.parent_assignment_id
         AND parent.assignment_date = ${today}
         AND parent.deleted_at IS NULL
        WHERE me.assigned_user_id = ${userId}::uuid
          AND me.assignment_date = ${today}
          AND me.deleted_at IS NULL
          AND me.parent_assignment_id IS NOT NULL
        UNION
        -- My own machines
        SELECT machine_id FROM my_assignments
      )
      SELECT DISTINCT ON (mle.machine_id)
        mle.machine_id                                        AS "machineId",
        m.machine_type                                        AS "machineType",
        COALESCE(m.internal_code, m.registration_plate)      AS "machineCode",
        mle.operator_id                                       AS "operatorId",
        u.full_name                                           AS "operatorName",
        au.id                                                 AS "assignedUserId",
        au.full_name                                          AS "assignedUserName",
        mle.lat::float          AS lat,
        mle.lon::float          AS lon,
        mle.accuracy_m::float   AS "accuracyM",
        mle.heading_deg::float  AS "headingDeg",
        mle.speed_ms::float     AS "speedMs",
        mle.recorded_at  AS "recordedAt"
      FROM machine_location_events mle
      JOIN sibling_machines sm ON sm.machine_id = mle.machine_id
      LEFT JOIN machines m  ON m.id = mle.machine_id
      LEFT JOIN users    u  ON u.id = mle.operator_id
      LEFT JOIN users    au ON au.assigned_machine_id = mle.machine_id
                            AND au.deleted_at IS NULL
      WHERE mle.recorded_at >= NOW() - INTERVAL '30 minutes'
      ORDER BY mle.machine_id, mle.recorded_at DESC
    `);

    return result as unknown as MachineLastLocation[];
  }

  /**
   * Return trucks currently within proximity of the given loader machine,
   * scoped to the caller's organization.
   *
   * Match criteria:
   *   - machine_type = 'truck'
   *   - both machines have at least one GPS report in the last `windowMinutes`
   *   - latest truck position is within `radiusM` meters of the latest loader position
   */
  async getTrucksAtLoader(
    loaderMachineId: string,
    options: { radiusM?: number; windowMinutes?: number } = {},
    orgId: string | null,
  ): Promise<
    Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
      tripStatus: string | null;
      loadState: 'loaded' | 'empty';
    }>
  > {
    const radiusM = options.radiusM ?? 75;
    // 15 min (not 5): mobile GPS reporting is time-based but a backgrounded or
    // briefly-idle device can still gap. A wider window keeps a truck that
    // arrived at the loader visible through short reporting lulls.
    const windowMinutes = options.windowMinutes ?? 15;

    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
      throw new BadRequestException('windowMinutes must be an integer between 1 and 60');
    }

    if (orgId !== null) {
      const loaderCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${loaderMachineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (loaderCheck.length === 0) {
        throw new BadRequestException('Loader machine not found in your organization');
      }
    }

    const orgFilter = orgId !== null ? sql`AND m.organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(sql`
      WITH loader_pos AS (
        SELECT coords, recorded_at
        FROM machine_location_events
        WHERE machine_id = ${loaderMachineId}::uuid
          AND recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY recorded_at DESC
        LIMIT 1
      ),
      latest_truck_pos AS (
        SELECT DISTINCT ON (mle.machine_id)
          mle.machine_id,
          mle.coords,
          mle.lat,
          mle.lon,
          mle.recorded_at
        FROM machine_location_events mle
        JOIN machines m ON m.id = mle.machine_id
        WHERE m.machine_type = 'truck'
          AND m.deleted_at IS NULL
          ${orgFilter}
          AND mle.recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY mle.machine_id, mle.recorded_at DESC
      )
      SELECT
        m.id                                                           AS id,
        m.registration_plate                                           AS "registrationPlate",
        m.internal_code                                                AS "internalCode",
        u.full_name                                                    AS "driverName",
        ROUND(ST_Distance(ltp.coords::geography, lp.coords::geography)::numeric, 1)::float AS "distanceM",
        ltp.recorded_at                                                AS "lastSeenAt",
        ltp.lat::float                                                 AS lat,
        ltp.lon::float                                                 AS lon,
        ct.trip_status                                                 AS "tripStatus",
        CASE
          WHEN ct.trip_status IN ('loaded', 'in_transit', 'arrived', 'delivering')
            THEN 'loaded' ELSE 'empty'
        END                                                            AS "loadState"
      FROM latest_truck_pos ltp
      JOIN loader_pos lp        ON TRUE
      JOIN machines m           ON m.id = ltp.machine_id
                                ${orgFilter}
      LEFT JOIN users u         ON u.assigned_machine_id = m.id
                                AND u.role = 'driver'::user_role
                                AND u.deleted_at IS NULL
      -- Current (non-terminal) trip for the truck, most recent first. Drives the
      -- loaded/empty badge: 'loaded' once the truck carries bales, else 'empty'
      -- (waiting / being loaded / no active trip).
      LEFT JOIN LATERAL (
        SELECT t.status AS trip_status
        FROM trips t
        WHERE t.truck_id = m.id
          AND t.deleted_at IS NULL
          AND t.status NOT IN ('completed', 'cancelled')
        ORDER BY t.updated_at DESC
        LIMIT 1
      ) ct ON TRUE
      WHERE ST_DWithin(ltp.coords::geography, lp.coords::geography, ${radiusM})
      ORDER BY "distanceM" ASC
      LIMIT 50
    `);

    return result as unknown as Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
      tripStatus: string | null;
      loadState: 'loaded' | 'empty';
    }>;
  }

  /**
   * The loader's work board (drives the loader home screen).
   *
   *  • `assigned` — NON-auxiliary trips whose loader_id is this machine, still
   *    to-load (planned/loading/loaded), each with a GPS-derived presence
   *    (here / enroute / loaded / unknown). Keyed on loader_id (the MACHINE):
   *    loader_operator_id is nullable on dispatcher-planned trips.
   *  • `nearbyUnassigned` — the proximity result minus the assigned trucks, so
   *    no truck appears twice (assigned wins).
   *
   * Auxiliary trips are intentionally excluded (is_auxiliary = false): the
   * mobile screen renders them from the dedicated auxiliary endpoint so the
   * offline aux-load flow is preserved.
   */
  async getLoaderBoard(
    loaderMachineId: string,
    options: { radiusM?: number; windowMinutes?: number } = {},
    orgId: string | null,
  ): Promise<{
    assigned: Array<{
      tripId: string;
      truckId: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      sourceParcelName: string | null;
      sourceParcelMunicipality: string | null;
      tripStatus: 'planned' | 'loading' | 'loaded';
      isAuxiliary: boolean;
      presence: 'here' | 'enroute' | 'loaded' | 'unknown';
      distanceM: number | null;
      lastSeenAt: string | null;
      loadState: 'loaded' | 'empty';
    }>;
    nearbyUnassigned: Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
      tripStatus: string | null;
      loadState: 'loaded' | 'empty';
    }>;
  }> {
    const radiusM = options.radiusM ?? 75;
    const windowMinutes = options.windowMinutes ?? 15;

    // Proximity set (also validates windowMinutes + loader-in-org membership).
    const nearby = await this.getTrucksAtLoader(loaderMachineId, { radiusM, windowMinutes }, orgId);

    const orgFilter = orgId !== null ? sql`AND t.organization_id = ${orgId}::uuid` : sql``;

    const assignedRows = (await this.drizzleProvider.db.execute(sql`
      WITH loader_pos AS (
        SELECT coords
        FROM machine_location_events
        WHERE machine_id = ${loaderMachineId}::uuid
          AND recorded_at >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
        ORDER BY recorded_at DESC
        LIMIT 1
      ),
      truck_pos AS (
        SELECT DISTINCT ON (mle.machine_id)
          mle.machine_id, mle.coords, mle.recorded_at
        FROM machine_location_events mle
        WHERE mle.recorded_at >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
        ORDER BY mle.machine_id, mle.recorded_at DESC
      )
      SELECT DISTINCT ON (t.truck_id)
        t.id                          AS "tripId",
        t.truck_id                    AS "truckId",
        m.registration_plate          AS "registrationPlate",
        m.internal_code               AS "internalCode",
        u.full_name                   AS "driverName",
        p.name                        AS "sourceParcelName",
        p.municipality                AS "sourceParcelMunicipality",
        t.status                      AS "tripStatus",
        t.is_auxiliary                AS "isAuxiliary",
        CASE
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL
            THEN ROUND(ST_Distance(tp.coords::geography, lp.coords::geography)::numeric, 1)::float
          ELSE NULL
        END                           AS "distanceM",
        tp.recorded_at                AS "lastSeenAt",
        CASE
          WHEN t.status = 'loaded' THEN 'loaded'
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL
               AND ST_DWithin(tp.coords::geography, lp.coords::geography, ${radiusM}) THEN 'here'
          WHEN tp.coords IS NOT NULL AND lp.coords IS NOT NULL THEN 'enroute'
          ELSE 'unknown'
        END                           AS "presence",
        CASE WHEN t.status = 'loaded' THEN 'loaded' ELSE 'empty' END AS "loadState"
      FROM trips t
      JOIN machines m           ON m.id = t.truck_id AND m.deleted_at IS NULL
      LEFT JOIN users u         ON u.id = t.driver_id
      LEFT JOIN parcels p       ON p.id = t.source_parcel_id AND p.deleted_at IS NULL
      LEFT JOIN truck_pos tp    ON tp.machine_id = t.truck_id
      LEFT JOIN loader_pos lp   ON TRUE
      WHERE t.loader_id = ${loaderMachineId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_auxiliary = false
        AND t.status IN ('planned', 'loading', 'loaded')
        ${orgFilter}
      ORDER BY t.truck_id, t.updated_at DESC
    `)) as unknown as Array<{
      tripId: string;
      truckId: string;
      registrationPlate: string | null;
      internalCode: string | null;
      driverName: string | null;
      sourceParcelName: string | null;
      sourceParcelMunicipality: string | null;
      tripStatus: 'planned' | 'loading' | 'loaded';
      isAuxiliary: boolean;
      presence: 'here' | 'enroute' | 'loaded' | 'unknown';
      distanceM: number | null;
      lastSeenAt: string | null;
      loadState: 'loaded' | 'empty';
    }>;

    const assignedTruckIds = new Set(assignedRows.map((r) => r.truckId));
    const nearbyUnassigned = nearby.filter((truck) => !assignedTruckIds.has(truck.id));

    return { assigned: assignedRows, nearbyUnassigned };
  }

  /**
   * Return loaders currently within proximity of the given truck machine,
   * scoped to the caller's organization. Mirror of getTrucksAtLoader, inverted:
   * lets a driver see the loaders parked nearby.
   *
   * Match criteria:
   *   - machine_type = 'loader'
   *   - both machines have at least one GPS report in the last `windowMinutes`
   *   - latest loader position is within `radiusM` meters of the latest truck position
   */
  async getLoadersNearTruck(
    truckMachineId: string,
    options: { radiusM?: number; windowMinutes?: number } = {},
    orgId: string | null,
  ): Promise<
    Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      operatorName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
    }>
  > {
    const radiusM = options.radiusM ?? 75;
    // 15 min (not 5): mirror of getTrucksAtLoader — tolerate short reporting
    // lulls so a parked loader stays visible to the driver.
    const windowMinutes = options.windowMinutes ?? 15;

    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
      throw new BadRequestException('windowMinutes must be an integer between 1 and 60');
    }

    if (orgId !== null) {
      const truckCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines
        WHERE id = ${truckMachineId}::uuid
          AND organization_id = ${orgId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as { id: string }[];
      if (truckCheck.length === 0) {
        throw new BadRequestException('Truck machine not found in your organization');
      }
    }

    const orgFilter = orgId !== null ? sql`AND m.organization_id = ${orgId}::uuid` : sql``;

    const result = await this.drizzleProvider.db.execute(sql`
      WITH truck_pos AS (
        SELECT coords, recorded_at
        FROM machine_location_events
        WHERE machine_id = ${truckMachineId}::uuid
          AND recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY recorded_at DESC
        LIMIT 1
      ),
      latest_loader_pos AS (
        SELECT DISTINCT ON (mle.machine_id)
          mle.machine_id,
          mle.coords,
          mle.lat,
          mle.lon,
          mle.recorded_at
        FROM machine_location_events mle
        JOIN machines m ON m.id = mle.machine_id
        WHERE m.machine_type = 'loader'
          AND m.deleted_at IS NULL
          ${orgFilter}
          AND mle.recorded_at >= NOW() - INTERVAL '${sql.raw(String(windowMinutes))} minutes'
        ORDER BY mle.machine_id, mle.recorded_at DESC
      )
      SELECT
        m.id                                                           AS id,
        m.registration_plate                                           AS "registrationPlate",
        m.internal_code                                                AS "internalCode",
        u.full_name                                                    AS "operatorName",
        ROUND(ST_Distance(llp.coords::geography, tp.coords::geography)::numeric, 1)::float AS "distanceM",
        llp.recorded_at                                                AS "lastSeenAt",
        llp.lat::float                                                 AS lat,
        llp.lon::float                                                 AS lon
      FROM latest_loader_pos llp
      JOIN truck_pos tp         ON TRUE
      JOIN machines m           ON m.id = llp.machine_id
                                ${orgFilter}
      LEFT JOIN users u         ON u.assigned_machine_id = m.id
                                AND u.role = 'loader_operator'::user_role
                                AND u.deleted_at IS NULL
      WHERE ST_DWithin(llp.coords::geography, tp.coords::geography, ${radiusM})
      ORDER BY "distanceM" ASC
      LIMIT 50
    `);

    return result as unknown as Array<{
      id: string;
      registrationPlate: string | null;
      internalCode: string | null;
      operatorName: string | null;
      distanceM: number;
      lastSeenAt: string;
      lat: number;
      lon: number;
    }>;
  }

  /**
   * Return the GPS route history for a specific machine within a time range,
   * scoped to the caller's organization. Points are ordered chronologically
   * (ASC) with a safety cap of {@link ROUTE_HISTORY_LIMIT} rows.
   *
   * The track is cleaned before it is returned: fixes the device itself flagged
   * as inaccurate are removed, impossible legs are dropped, and the point list
   * is cut into `segments` wherever reporting stopped — see
   * {@link cleanRoutePoints}. Pass `{ raw: true }` to bypass all of it.
   *
   * Nothing is deleted from `machine_location_events`; this is a read-time view.
   */
  async getRouteHistory(
    machineId: string,
    from: string,
    to: string,
    orgId: string | null,
    options: RouteHistoryOptions = {},
  ): Promise<RouteHistoryResponse> {
    // Validate machineId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(machineId)) {
      throw new BadRequestException('Invalid machineId: must be a valid UUID');
    }

    // Validate from/to are valid ISO-8601 dates
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" parameter: must be a valid ISO-8601 date');
    }
    if (isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" parameter: must be a valid ISO-8601 date');
    }
    if (fromDate >= toDate) {
      throw new BadRequestException('"from" must be before "to"');
    }

    const machineCheck: ReturnType<typeof sql>[] = [
      sql`id = ${machineId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) machineCheck.push(sql`organization_id = ${orgId}::uuid`);
    const machineWhere = sql.join(machineCheck, sql` AND `);

    const machineResult = await this.drizzleProvider.db.execute(sql`
      SELECT
        COALESCE(internal_code, registration_plate) AS "machineCode",
        machine_type AS "machineType"
      FROM machines
      WHERE ${machineWhere}
      LIMIT 1
    `);
    const machine =
      (
        machineResult as unknown as Array<{
          machineCode: string | null;
          machineType: string | null;
        }>
      )[0] ?? null;

    if (!machine) {
      throw new BadRequestException('Machine not found');
    }

    const raw = options.raw === true;
    // No accuracy gate unless one is explicitly asked for. Gating a TRACK on
    // accuracy was tried and reverted: it removed a third of a healthy day for
    // no gain — the kinematic tests already caught every impossible leg — and
    // the holes it opened tripped the outage split, fragmenting a continuous
    // track. Distance totals still gate (see getKmByDay); a sum is vulnerable
    // to jitter in a way a drawn line is not.
    const maxAccuracyM =
      !raw && Number.isFinite(options.maxAccuracyM) && (options.maxAccuracyM as number) > 0
        ? Math.min(Math.max(options.maxAccuracyM as number, 5), 100_000)
        : null;

    // When a gate IS requested it belongs INSIDE the row cap: filtering after
    // LIMIT would silently truncate the tail of a noisy month, not the noise.
    const accuracyFilter =
      maxAccuracyM === null
        ? sql``
        : sql`AND accuracy_m IS NOT NULL AND accuracy_m <= ${maxAccuracyM}`;

    // `::float` on every NUMERIC column. postgres.js returns NUMERIC as JS
    // *strings*, and every sibling query in this file already casts (see
    // getMachineLastLocations / getTrucksAtLoader). This one did not, so
    // `RoutePoint.lat` was typed number but was "45.1234567" at runtime — it
    // only worked because Leaflet coerces. Arithmetic below would not.
    // Check-in fixes are presence data, not track data (see the mobile
    // getBestEffortPosition): a phone whose location task died still posts a
    // network fix every 60 s, and those hop between cell towers kilometres
    // apart. Raw mode keeps them — it must show exactly what was stored.
    const sourceFilter = raw ? sql`` : sql`AND (source IS NULL OR source <> 'checkin')`;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        lat::float          AS lat,
        lon::float          AS lon,
        accuracy_m::float   AS "accuracyM",
        heading_deg::float  AS "headingDeg",
        speed_ms::float     AS "speedMs",
        recorded_at         AS "recordedAt"
      FROM machine_location_events
      WHERE machine_id = ${machineId}::uuid
        AND recorded_at >= ${from}::timestamptz
        AND recorded_at <= ${to}::timestamptz
        ${accuracyFilter}
        ${sourceFilter}
      ORDER BY recorded_at ASC
      LIMIT ${ROUTE_HISTORY_LIMIT + 1}
    `);

    // One row over the cap is a sentinel: it tells us the track is incomplete
    // without making the caller guess from a suspiciously round count.
    const fetched = result as unknown as RoutePoint[];
    const truncated = fetched.length > ROUTE_HISTORY_LIMIT;
    const bounded = truncated ? fetched.slice(0, ROUTE_HISTORY_LIMIT) : fetched;

    // Slow machines get two extra defences the truck-calibrated kinematics
    // cannot provide: a type-appropriate speed cap (a telehandler doing a
    // "legal" 118 km/h between cell towers is still noise) and the
    // skeleton-consistency pass. Both are measured UNSAFE for trucks — their
    // fused "exactly 100 m" road fixes are real positions that the skeleton
    // would delete wholesale — so trucks keep the plain cleaner.
    const isSlowMachine = machine.machineType !== 'truck';

    // Raw mode is the UI's escape hatch: it must reproduce exactly what the
    // endpoint used to return, so it bypasses the cleaner entirely.
    const cleaned = raw
      ? {
          points: bounded,
          segments: bounded.length > 0 ? [{ startIndex: 0, endIndex: bounded.length - 1 }] : [],
          stats: {
            rawPoints: bounded.length,
            keptPoints: bounded.length,
            droppedLowAccuracy: 0,
            droppedOutlier: 0,
            droppedBadTimestamp: 0,
            droppedSpike: 0,
            droppedPresence: 0,
            segmentCount: bounded.length > 0 ? 1 : 0,
          },
        }
      : cleanRoutePoints(bounded, {
          ...(maxAccuracyM === null ? {} : { maxAccuracyM }),
          maxSpeedMs: SPEED_CAP_MS,
          maxLegM: SEGMENT_CAP_M,
          slowCap: isSlowMachine
            ? { maxSpeedMs: SLOW_MACHINE_SPEED_CAP_MS, minLegM: SLOW_MACHINE_MIN_LEG_M }
            : null,
          skeleton: isSlowMachine,
        });

    // `rawPoints` must count what the window HOLDS, not what survived the SQL
    // gate, otherwise the UI cannot report how much was hidden as noise.
    const counts = raw
      ? { total: bounded.length, checkin: 0 }
      : await this.countRoutePoints(machineId, from, to);

    return {
      machineId,
      machineCode: machine?.machineCode ?? null,
      machineType: machine?.machineType ?? null,
      from,
      to,
      totalPoints: cleaned.points.length,
      points: cleaned.points,
      segments: cleaned.segments,
      filter: {
        rawPoints: counts.total,
        keptPoints: cleaned.points.length,
        // Rows the SQL filters hid split by cause: check-in rows are presence
        // data, the remainder (only present when an explicit accuracy cap was
        // requested) fell to the accuracy gate.
        droppedLowAccuracy:
          Math.max(0, counts.total - counts.checkin - bounded.length) +
          cleaned.stats.droppedLowAccuracy,
        droppedOutlier: cleaned.stats.droppedOutlier,
        droppedBadTimestamp: cleaned.stats.droppedBadTimestamp,
        droppedSpike: cleaned.stats.droppedSpike,
        droppedPresence: cleaned.stats.droppedPresence + counts.checkin,
        accuracyCapM: maxAccuracyM,
        truncated,
      },
    };
  }

  /**
   * Unfiltered point count for a machine's time window (denominator for filter
   * stats), plus how many of those are check-in-source presence fixes the
   * track query excludes up front.
   */
  private async countRoutePoints(
    machineId: string,
    from: string,
    to: string,
  ): Promise<{ total: number; checkin: number }> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE source = 'checkin')::int AS checkin
      FROM machine_location_events
      WHERE machine_id = ${machineId}::uuid
        AND recorded_at >= ${from}::timestamptz
        AND recorded_at <= ${to}::timestamptz
    `)) as unknown as Array<{ total: number; checkin: number }>;
    return rows[0] ?? { total: 0, checkin: 0 };
  }

  /**
   * Return per-day kilometre totals for one machine in the date range
   * [from, to] inclusive. Each day's km comes from summing pairwise
   * `ST_DistanceSphere` legs between consecutive GPS samples in that UTC
   * day. Days with no data return `km=0, pointCount=0` (zero-fill via
   * `generate_series`) so charts stay contiguous.
   *
   * Noise handling mirrors `reports.service.ts`: fixes worse than
   * {@link ACCURACY_CAP_M} are excluded, and a leg longer than
   * {@link SEGMENT_CAP_M} or faster than {@link SPEED_CAP_MS} contributes zero.
   * Without this a telehandler read ~4 518 km/month instead of ~878 — the noise
   * was inflating distance roughly fivefold.
   *
   * Deliberate asymmetry with the map: a track SPLITS on a reporting outage
   * because drawing a straight line across it would be a lie, but this SUMS
   * across one, because the machine plausibly did travel while unreported. Only
   * legs that are impossible (too far / too fast) are zeroed here.
   *
   * Validation:
   *  - `from`, `to` must be ISO dates and `from <= to`.
   *  - Range is capped at 90 days to avoid abuse.
   *
   * Scoping: machine must belong to the caller's organization.
   */
  async getKmByDay(
    machineId: string,
    from: string,
    to: string,
    orgId: string | null,
  ): Promise<KmByDayResponse> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
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

    // Machine in-org check (mirrors getRouteHistory).
    const machineCheck: ReturnType<typeof sql>[] = [
      sql`id = ${machineId}::uuid`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) machineCheck.push(sql`organization_id = ${orgId}::uuid`);
    const machineWhere = sql.join(machineCheck, sql` AND `);

    const machineResult = (await this.drizzleProvider.db.execute(sql`
      SELECT COALESCE(internal_code, registration_plate) AS "machineCode",
             machine_type AS "machineType"
      FROM machines
      WHERE ${machineWhere}
      LIMIT 1
    `)) as unknown as Array<{
      machineCode: string | null;
      machineType: string | null;
    }>;
    const machine = machineResult[0] ?? null;
    if (!machine) {
      throw new BadRequestException('Machine not found');
    }

    const result = (await this.drizzleProvider.db.execute(sql`
      WITH pts AS (
        SELECT
          (recorded_at AT TIME ZONE 'UTC')::date AS day,
          recorded_at,
          ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
        FROM machine_location_events
        WHERE machine_id = ${machineId}::uuid
          AND recorded_at >= ${from}::date
          AND recorded_at <  (${to}::date + INTERVAL '1 day')
          AND accuracy_m IS NOT NULL
          AND accuracy_m <= ${ACCURACY_CAP_M}
          AND (source IS NULL OR source <> 'checkin')
      ),
      pairwise AS (
        SELECT
          day,
          ST_DistanceSphere(
            LAG(geom) OVER w,
            geom
          ) AS leg_m,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER w)) AS dt_s
        FROM pts
        WINDOW w AS (PARTITION BY day ORDER BY recorded_at)
      ),
      clean AS (
        SELECT
          day,
          CASE
            WHEN leg_m IS NULL OR dt_s IS NULL OR dt_s = 0 THEN 0
            WHEN leg_m > ${SEGMENT_CAP_M} THEN 0
            WHEN (leg_m / dt_s) > ${SPEED_CAP_MS} THEN 0
            ELSE leg_m
          END AS leg_m
        FROM pairwise
      ),
      per_day AS (
        SELECT
          day,
          COALESCE(SUM(leg_m), 0) / 1000.0 AS km,
          COUNT(*)                          AS point_count
        FROM clean
        GROUP BY day
      ),
      all_days AS (
        SELECT generate_series(${from}::date, ${to}::date, INTERVAL '1 day')::date AS day
      )
      SELECT
        a.day::text                                  AS date,
        ROUND(COALESCE(p.km, 0)::numeric, 2)::float  AS km,
        COALESCE(p.point_count, 0)::int              AS "pointCount"
      FROM all_days a
      LEFT JOIN per_day p USING (day)
      ORDER BY a.day
    `)) as unknown as Array<{ date: string; km: number; pointCount: number }>;

    return {
      machineId,
      machineCode: machine.machineCode,
      machineType: machine.machineType,
      from,
      to,
      days: result,
    };
  }
}
