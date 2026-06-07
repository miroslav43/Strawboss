import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { getAvailableTransitions } from '@strawboss/domain';
import type { TripStatus } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { todayInRomania } from '../common/date';

// GPS-tolerance geofence detection. Phone GPS drifts 5–20 m and operators work
// at field edges, so exact ST_Contains misses "I'm on the field" constantly
// (a baler 8 m outside a parcel produced no enter event). We treat the machine
// as INSIDE within ENTER_M of the boundary, and only OUTSIDE past EXIT_M — the
// gap is hysteresis so a machine parked near the edge does not flap enter/exit
// on GPS noise. Both are env-tunable.
const GEOFENCE_ENTER_TOLERANCE_M = Number(process.env.STRAWBOSS_GEOFENCE_ENTER_M) || 30;
const GEOFENCE_EXIT_TOLERANCE_M = Number(process.env.STRAWBOSS_GEOFENCE_EXIT_M) || 60;

interface ActiveAssignment {
  assignmentId: string;
  machineId: string;
  machineType: string;
  parcelId: string | null;
  destinationId: string | null;
  assignedUserId: string | null;
  parcelName: string | null;
  parcelCode: string | null;
  cropType: string | null;
  status: string;
  tripId: string | null;
  tripStatus: string | null;
  organizationId: string | null;
}

interface MachinePosition {
  machineId: string;
  lat: number;
  lon: number;
}

interface GeofenceCheck {
  /** Metres from the GPS point to the geofence boundary (0 when inside). */
  dist: number | string | null;
}

interface LastEvent {
  machineId: string;
  geofenceId: string;
  eventType: string;
}

@Injectable()
export class GeofenceService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notificationsService: NotificationsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Main check loop: for each machine with active assignments today,
   * compare GPS position against parcel/deposit boundaries.
   */
  async checkMachinePositions(): Promise<void> {
    const today = todayInRomania();

    // 1. Get all active assignments for today (available or in_progress)
    const assignmentsResult = await this.drizzleProvider.db.execute(sql`
      SELECT
        ta.id            AS "assignmentId",
        ta.machine_id    AS "machineId",
        m.machine_type   AS "machineType",
        ta.parcel_id     AS "parcelId",
        ta.destination_id AS "destinationId",
        ta.assigned_user_id AS "assignedUserId",
        p.name           AS "parcelName",
        p.code           AS "parcelCode",
        p.crop_type      AS "cropType",
        ta.status,
        ta.trip_id       AS "tripId",
        t.status         AS "tripStatus",
        ta.organization_id AS "organizationId"
      FROM task_assignments ta
      JOIN machines m ON m.id = ta.machine_id
      LEFT JOIN parcels p ON p.id = ta.parcel_id
      LEFT JOIN trips t ON t.id = ta.trip_id
      WHERE ta.assignment_date = ${today}
        AND ta.deleted_at IS NULL
        AND ta.status IN ('available', 'in_progress')
    `);
    const assignments = assignmentsResult as unknown as ActiveAssignment[];

    if (assignments.length === 0) return;

    // 2. Get unique machine IDs and their latest GPS positions
    const machineIds = [...new Set(assignments.map((a) => a.machineId))];
    // Build an explicit IN-list: Drizzle expands a JS array into a
    // comma-separated row, which Postgres reads as a `record` and refuses to
    // cast to uuid[]. A joined list of individually-cast values is safe.
    const machineIdList = sql.join(
      machineIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const positionsResult = await this.drizzleProvider.db.execute(sql`
      SELECT DISTINCT ON (machine_id)
        machine_id AS "machineId",
        lat,
        lon
      FROM machine_location_events
      WHERE machine_id IN (${machineIdList})
        AND recorded_at >= NOW() - INTERVAL '10 minutes'
      ORDER BY machine_id, recorded_at DESC
    `);
    const positions = positionsResult as unknown as MachinePosition[];
    const posMap = new Map(positions.map((p) => [p.machineId, p]));

    if (positions.length === 0) return;

    // 3. For each assignment, check if the machine is inside the target geofence
    for (const assignment of assignments) {
      const pos = posMap.get(assignment.machineId);
      if (!pos) continue;

      // A truck task carries BOTH a source parcel and a destination deposit.
      // Check every boundary the assignment has — entering the deposit is what
      // tells the driver they have arrived, and it was previously never checked
      // (the old `parcelId ?? destinationId` only ever looked at the parcel).
      const targets: { type: 'parcel' | 'deposit'; id: string }[] = [];
      if (assignment.parcelId) targets.push({ type: 'parcel', id: assignment.parcelId });
      if (assignment.destinationId) {
        targets.push({ type: 'deposit', id: assignment.destinationId });
      }

      for (const target of targets) {
        const geofenceId = target.id;
        const geofenceType: 'parcel' | 'deposit' = target.type;
        const table = geofenceType === 'parcel' ? 'parcels' : 'delivery_destinations';

        // Distance (metres) from the GPS point to the geofence boundary; 0 when
        // the point is strictly inside. Tolerance + hysteresis are applied in JS
        // below — exact ST_Contains was too strict for real phone GPS.
        const distResult = await this.drizzleProvider.db.execute(sql`
        SELECT ST_Distance(
          boundary::geography,
          ST_SetSRID(ST_MakePoint(${pos.lon}, ${pos.lat}), 4326)::geography
        ) AS "dist"
        FROM ${sql.raw(table)}
        WHERE id = ${geofenceId}::uuid
          AND boundary IS NOT NULL
      `);
        const check = (distResult as unknown as GeofenceCheck[])[0];
        if (!check || check.dist == null) continue;
        const distM = Number(check.dist);

        // 4. Get last known geofence event for this machine + geofence pair
        const lastEventResult = await this.drizzleProvider.db.execute(sql`
        SELECT event_type AS "eventType"
        FROM geofence_events
        WHERE machine_id = ${assignment.machineId}::uuid
          AND geofence_id = ${geofenceId}::uuid
          AND assignment_id = ${assignment.assignmentId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `);
        const lastEvent = (lastEventResult as unknown as LastEvent[])[0];
        const wasInside = lastEvent?.eventType === 'enter';

        // Tolerance buffer + hysteresis: enter within ENTER_M, leave only past
        // EXIT_M (audit: baler was 8 m outside → strict containment never fired).
        const isInside = wasInside
          ? distM <= GEOFENCE_EXIT_TOLERANCE_M
          : distM <= GEOFENCE_ENTER_TOLERANCE_M;

        // 5. Detect transitions
        if (isInside && !wasInside) {
          // ENTER event
          await this.recordEvent(
            assignment.machineId,
            assignment.assignmentId,
            geofenceType,
            geofenceId,
            'enter',
            pos.lat,
            pos.lon,
          );

          // No machine auto-flips to in_progress on a geofence enter anymore.
          // Every machine type now confirms the entry overlay first
          // (POST /notifications/confirm-parcel-entry) — so a mere drive-through
          // does not silently start the task (audit #2). The push below drives
          // that confirmation overlay, with copy tailored per machine type.
          if (geofenceType === 'parcel' && assignment.assignedUserId && assignment.parcelId) {
            const parcelRef = {
              id: assignment.parcelId,
              code: assignment.parcelCode ?? assignment.parcelName ?? '—',
              name: assignment.parcelName,
            };
            if (assignment.machineType === 'baler') {
              // T6 enter — rich 10 s auto-confirm overlay with crop context.
              await this.notificationsService.sendBalerFieldEntryConfirm(
                assignment.assignedUserId,
                assignment.assignmentId,
                { ...parcelRef, cropType: assignment.cropType },
              );
            } else if (assignment.machineType === 'loader') {
              await this.notificationsService.sendFieldEntryConfirm(
                assignment.assignedUserId,
                assignment.assignmentId,
                parcelRef,
                'load',
              );
            } else if (assignment.machineType === 'truck') {
              await this.notificationsService.sendFieldEntryConfirm(
                assignment.assignedUserId,
                assignment.assignmentId,
                parcelRef,
                'truck',
              );
            }
          }

          // When a truck enters a parcel, also notify any loader/baler operator
          // who is assigned to the same parcel today — they need to know a
          // truck has arrived at their field so they can start loading.
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'truck' &&
            assignment.parcelId
          ) {
            await this.notifyLoadersAtParcel(
              assignment.parcelId,
              assignment.machineId,
              assignment.parcelName,
              assignment.assignmentId,
              today,
              assignment.organizationId,
            );
          }

          // Notify driver when truck enters deposit geofence
          if (geofenceType === 'deposit' && assignment.assignedUserId) {
            await this.notificationsService.sendPush(
              assignment.assignedUserId,
              'Ai ajuns la depozit',
              'Confirmă sosirea ca să închei cursa.',
              {
                type: 'deposit_entry',
                assignmentId: assignment.assignmentId,
                tripId: assignment.tripId,
              },
            );
          }
        } else if (!isInside && wasInside) {
          // EXIT event
          await this.recordEvent(
            assignment.machineId,
            assignment.assignmentId,
            geofenceType,
            geofenceId,
            'exit',
            pos.lat,
            pos.lon,
          );

          this.winston.log(
            'flow',
            `Machine ${assignment.machineId} exited ${geofenceType} ${geofenceId}`,
            {
              context: 'GeofenceService',
              machineId: assignment.machineId,
              geofenceType,
              geofenceId,
              assignmentId: assignment.assignmentId,
              event: 'exit',
            },
          );

          // T6 exit — when a baler leaves a parcel, send the loud-horn
          // production push that routes the operator straight to the
          // bale-count entry screen (which marks the parcel done + records
          // production via /notifications/confirm-parcel-done).
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'baler' &&
            assignment.assignedUserId &&
            assignment.parcelId
          ) {
            await this.notificationsService.sendBalerFieldExitProduction(
              assignment.assignedUserId,
              assignment.assignmentId,
              {
                id: assignment.parcelId,
                code: assignment.parcelCode ?? assignment.parcelName ?? '—',
                name: assignment.parcelName,
              },
            );
          }

          // Loader exit — only if the loader actually worked this field
          // (in_progress, i.e. it confirmed the entry overlay). Ask whether the
          // field is fully loaded/done; "Da" reconciles produced vs loaded
          // bales via POST /notifications/confirm-parcel-loaded (audit #1).
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'loader' &&
            assignment.assignedUserId &&
            assignment.parcelId &&
            assignment.status === 'in_progress'
          ) {
            await this.notificationsService.sendLoaderFieldExitConfirm(
              assignment.assignedUserId,
              assignment.assignmentId,
              { id: assignment.parcelId, name: assignment.parcelName },
            );
          }

          // Truck exit from the source parcel — if the trip is loaded and DEPART
          // is a valid transition, prompt the driver to start the departure flow
          // (audit #3). We never auto-fire DEPART: it needs the real odometer +
          // driver signature (CMR / fuel anti-fraud), which the driver supplies
          // in the departure-flow screen this push routes to.
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'truck' &&
            assignment.assignedUserId &&
            assignment.tripId &&
            assignment.tripStatus &&
            getAvailableTransitions(assignment.tripStatus as TripStatus).includes('DEPART')
          ) {
            await this.notificationsService.sendPush(
              assignment.assignedUserId,
              'Ai plecat de la câmp?',
              'Confirmă plecarea ca să pornești cursa spre depozit.',
              {
                type: 'depart_prompt',
                assignmentId: assignment.assignmentId,
                tripId: assignment.tripId,
              },
            );
          }
        }
      }
    }
  }

  /**
   * Notify any loader/baler operator assigned to the same parcel today that
   * a truck has arrived. Best-effort: a missing loader assignment, a missing
   * push token, or an Expo error never blocks the geofence event recording.
   */
  private async notifyLoadersAtParcel(
    parcelId: string,
    truckMachineId: string,
    parcelName: string | null,
    truckAssignmentId: string,
    today: string,
    orgId: string | null,
  ): Promise<void> {
    try {
      // Pull every loader/baler assignment for this parcel today plus the
      // truck plate so the push body has something useful to read. Scoped to
      // the truck's organization (defensive — a parcel already belongs to one
      // org, but this keeps the fan-out org-bounded by construction).
      const loaderRows = (await this.drizzleProvider.db.execute(sql`
        SELECT
          ta.assigned_user_id AS "userId",
          ta.id               AS "assignmentId",
          (SELECT registration_plate FROM machines WHERE id = ${truckMachineId}::uuid) AS "truckPlate"
        FROM task_assignments ta
        JOIN machines m ON m.id = ta.machine_id
        WHERE ta.parcel_id = ${parcelId}::uuid
          AND ta.assignment_date = ${today}
          AND ta.deleted_at IS NULL
          AND ta.status IN ('available', 'in_progress')
          AND m.machine_type IN ('loader', 'baler')
          AND ta.assigned_user_id IS NOT NULL
          AND ta.organization_id IS NOT DISTINCT FROM ${orgId}::uuid
      `)) as unknown as { userId: string; assignmentId: string; truckPlate: string | null }[];

      if (loaderRows.length === 0) return;

      const plate = loaderRows[0]?.truckPlate ?? 'un camion';
      const where = parcelName ?? 'câmpul tău';

      await Promise.all(
        loaderRows.map((row) =>
          this.notificationsService
            .sendPush(row.userId, 'A sosit un camion', `Camionul ${plate} a ajuns la ${where}.`, {
              type: 'truck_arrived_at_loader',
              assignmentId: row.assignmentId,
              truckMachineId,
              truckAssignmentId,
              truckPlate: plate,
              parcelName,
            })
            .catch(() => {
              // Best-effort — push failures must not break the geofence loop.
            }),
        ),
      );

      this.winston.log(
        'flow',
        `Notified ${loaderRows.length} loader(s) that truck ${truckMachineId} arrived at parcel ${parcelId}`,
        {
          context: 'GeofenceService',
          truckMachineId,
          parcelId,
          loaderCount: loaderRows.length,
        },
      );
    } catch (err) {
      this.winston.warn(`notifyLoadersAtParcel failed (parcel ${parcelId})`, {
        context: 'GeofenceService',
        parcelId,
        truckMachineId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /**
   * Run a geofence check immediately (instead of waiting for the 5-minute job)
   * and return a small diagnostic summary. Backs the admin trigger endpoint so
   * the full GPS → geofence → push chain can be tested on demand. The summary
   * surfaces the two silent-skip conditions: no active assignments today, or no
   * machine with a GPS fix in the last 10 minutes.
   */
  async runManualCheck(): Promise<{
    assignmentsToday: number;
    machinesWithRecentGps: number;
    eventsGenerated: number;
  }> {
    const today = todayInRomania();

    const assignmentsRes = (await this.drizzleProvider.db.execute(sql`
      SELECT count(*)::int AS n
      FROM task_assignments
      WHERE assignment_date = ${today}
        AND deleted_at IS NULL
        AND status IN ('available', 'in_progress')
    `)) as unknown as { n: number }[];

    const gpsRes = (await this.drizzleProvider.db.execute(sql`
      SELECT count(DISTINCT mle.machine_id)::int AS n
      FROM machine_location_events mle
      JOIN task_assignments ta ON ta.machine_id = mle.machine_id
      WHERE ta.assignment_date = ${today}
        AND ta.deleted_at IS NULL
        AND ta.status IN ('available', 'in_progress')
        AND mle.recorded_at >= NOW() - INTERVAL '10 minutes'
    `)) as unknown as { n: number }[];

    const beforeRes = (await this.drizzleProvider.db.execute(sql`
      SELECT count(*)::int AS n FROM geofence_events
    `)) as unknown as { n: number }[];

    await this.checkMachinePositions();

    const afterRes = (await this.drizzleProvider.db.execute(sql`
      SELECT count(*)::int AS n FROM geofence_events
    `)) as unknown as { n: number }[];

    const summary = {
      assignmentsToday: assignmentsRes[0]?.n ?? 0,
      machinesWithRecentGps: gpsRes[0]?.n ?? 0,
      eventsGenerated: (afterRes[0]?.n ?? 0) - (beforeRes[0]?.n ?? 0),
    };

    this.winston.log('flow', 'Manual geofence check triggered', {
      context: 'GeofenceService',
      ...summary,
    });

    return summary;
  }

  private async recordEvent(
    machineId: string,
    assignmentId: string,
    geofenceType: 'parcel' | 'deposit',
    geofenceId: string,
    eventType: 'enter' | 'exit',
    lat: number,
    lon: number,
  ): Promise<void> {
    await this.drizzleProvider.db.execute(sql`
      INSERT INTO geofence_events
        (machine_id, assignment_id, geofence_type, geofence_id, event_type, lat, lon)
      VALUES (
        ${machineId}::uuid,
        ${assignmentId}::uuid,
        ${geofenceType},
        ${geofenceId}::uuid,
        ${eventType},
        ${lat},
        ${lon}
      )
    `);
  }
}
