import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ProfileService } from '../profile/profile.service';
import { todayInRomania } from '../common/date';
import { QUEUE_GEOFENCE_CHECK } from '../jobs/queues';
import type {
  KmByDayResponse,
  LocationReportDto,
  MachineLastLocation,
  RouteHistoryResponse,
  RoutePoint,
} from '@strawboss/types';

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

  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly profileService: ProfileService,
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
        throw new BadRequestException('Machine not found in your organization');
      }
    }

    await this.drizzleProvider.db.execute(sql`
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, heading_deg, speed_ms, recorded_at)
      VALUES (
        ${machineId}::uuid,
        ${operatorId}::uuid,
        ${dto.lat},
        ${dto.lon},
        ${dto.accuracyM ?? null},
        ${dto.headingDeg ?? null},
        ${dto.speedMs ?? null},
        ${dto.recordedAt}::timestamptz
      )
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
   * Return the last known position for every machine that has reported GPS,
   * scoped to the caller's organization.
   * Admin-only endpoint.
   */
  async getLastKnownPositions(orgId: string | null): Promise<MachineLastLocation[]> {
    const whereConditions: ReturnType<typeof sql>[] = [sql`mle.machine_id IS NOT NULL`];
    if (orgId !== null) whereConditions.push(sql`m.organization_id = ${orgId}::uuid`);
    const where = sql.join(whereConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(sql`
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
    `);

    return result as unknown as MachineLastLocation[];
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
   * scoped to the caller's organization.
   * Points are ordered chronologically (ASC) with a safety cap of 50 000 rows.
   */
  async getRouteHistory(
    machineId: string,
    from: string,
    to: string,
    orgId: string | null,
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

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        lat,
        lon,
        accuracy_m   AS "accuracyM",
        heading_deg  AS "headingDeg",
        speed_ms     AS "speedMs",
        recorded_at  AS "recordedAt"
      FROM machine_location_events
      WHERE machine_id = ${machineId}::uuid
        AND recorded_at >= ${from}::timestamptz
        AND recorded_at <= ${to}::timestamptz
      ORDER BY recorded_at ASC
      LIMIT 50000
    `);

    const points = result as unknown as RoutePoint[];

    return {
      machineId,
      machineCode: machine?.machineCode ?? null,
      machineType: machine?.machineType ?? null,
      from,
      to,
      totalPoints: points.length,
      points,
    };
  }

  /**
   * Return per-day kilometre totals for one machine in the date range
   * [from, to] inclusive. Each day's km comes from summing pairwise
   * `ST_DistanceSphere` legs between consecutive GPS samples in that UTC
   * day. Days with no data return `km=0, pointCount=0` (zero-fill via
   * `generate_series`) so charts stay contiguous.
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
      ),
      pairwise AS (
        SELECT
          day,
          ST_DistanceSphere(
            LAG(geom) OVER (PARTITION BY day ORDER BY recorded_at),
            geom
          ) AS leg_m
        FROM pts
      ),
      per_day AS (
        SELECT
          day,
          COALESCE(SUM(leg_m), 0) / 1000.0 AS km,
          COUNT(*)                          AS point_count
        FROM pairwise
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
