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
// Radius at which a truck nearing its source parcel triggers a one-time
// "truck approaching" alert to the loaders waiting at that field. Env-tunable.
const GEOFENCE_APPROACH_M = Number(process.env.STRAWBOSS_GEOFENCE_APPROACH_M) || 5000;

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
  /** Driver on the linked trip — used as the push recipient for truck tasks,
   *  whose task_assignments often have no assigned_user_id. */
  tripDriverId: string | null;
  /** Operator assigned to the machine (users.assigned_machine_id) — the push
   *  recipient fallback for baler/loader tasks that have no assigned_user_id
   *  (operators are linked to the machine, not the daily task). */
  machineOperatorId: string | null;
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
        t.driver_id      AS "tripDriverId",
        mo.id            AS "machineOperatorId",
        ta.organization_id AS "organizationId"
      FROM task_assignments ta
      JOIN machines m ON m.id = ta.machine_id
      LEFT JOIN parcels p ON p.id = ta.parcel_id
      LEFT JOIN trips t ON t.id = ta.trip_id
      -- Operator linked to the machine (not the task). Baler/loader operators are
      -- assigned via users.assigned_machine_id, so this is the recipient fallback
      -- when the daily task has no assigned_user_id.
      LEFT JOIN LATERAL (
        SELECT mu.id
        FROM users mu
        WHERE mu.assigned_machine_id = ta.machine_id
          AND mu.deleted_at IS NULL
          AND mu.organization_id = ta.organization_id
        ORDER BY mu.updated_at DESC
        LIMIT 1
      ) mo ON TRUE
      WHERE ta.assignment_date = ${today}
        AND ta.deleted_at IS NULL
        AND ta.status IN ('available', 'in_progress')
    `);
    const assignments = assignmentsResult as unknown as ActiveAssignment[];

    if (assignments.length === 0) {
      this.winston.log('flow', 'geofence check: no active assignments today (nothing to check)', {
        context: 'GeofenceService',
        date: today,
      });
      return;
    }
    const balerAssignments = assignments.filter((a) => a.machineType === 'baler');
    this.winston.log(
      'flow',
      `geofence check: ${assignments.length} active assignment(s), ${balerAssignments.length} baler`,
      {
        context: 'GeofenceService',
        date: today,
        total: assignments.length,
        balers: balerAssignments.map((a) => ({
          machineId: a.machineId,
          parcelId: a.parcelId,
          assignedUserId: a.assignedUserId,
          status: a.status,
        })),
      },
    );

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

    if (positions.length === 0) {
      this.winston.log(
        'flow',
        'geofence check: no GPS fix in the last 10 min for any assigned machine',
        {
          context: 'GeofenceService',
          machineIds,
        },
      );
      return;
    }

    // 3. For each assignment, check if the machine is inside the target geofence
    for (const assignment of assignments) {
      const pos = posMap.get(assignment.machineId);
      if (!pos) {
        if (assignment.machineType === 'baler') {
          this.winston.log('flow', 'geofence baler: SKIP — no GPS fix in last 10 min', {
            context: 'GeofenceService',
            machineId: assignment.machineId,
            parcelId: assignment.parcelId,
            assignmentId: assignment.assignmentId,
          });
        }
        continue;
      }

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
        // Depots fall back to their centroid `coords` when they have no boundary
        // polygon (temporary depots), so approach/enter detection still works.
        const geomExpr =
          geofenceType === 'deposit' ? sql`COALESCE(boundary, coords)` : sql`boundary`;
        const geomNotNull =
          geofenceType === 'deposit'
            ? sql`(boundary IS NOT NULL OR coords IS NOT NULL)`
            : sql`boundary IS NOT NULL`;
        const distResult = await this.drizzleProvider.db.execute(sql`
        SELECT ST_Distance(
          ${geomExpr}::geography,
          ST_SetSRID(ST_MakePoint(${pos.lon}, ${pos.lat}), 4326)::geography
        ) AS "dist"
        FROM ${sql.raw(table)}
        WHERE id = ${geofenceId}::uuid
          AND ${geomNotNull}
      `);
        const check = (distResult as unknown as GeofenceCheck[])[0];
        if (!check || check.dist == null) {
          if (geofenceType === 'parcel' && assignment.machineType === 'baler') {
            this.winston.log('flow', 'geofence baler: SKIP — parcel has no boundary geometry', {
              context: 'GeofenceService',
              machineId: assignment.machineId,
              parcelId: assignment.parcelId,
              assignmentId: assignment.assignmentId,
            });
          }
          continue;
        }
        const distM = Number(check.dist);

        // Truck-approaching alert: when a truck nears its source parcel (within
        // APPROACH_M but not yet "arrived" past the enter tolerance), tell the
        // loaders waiting at that field — once. The fire-once guard is a single
        // 'approach' row per (truck, parcel, assignment); a re-check at a closer
        // distance finds the row and stays silent.
        if (
          geofenceType === 'parcel' &&
          assignment.machineType === 'truck' &&
          assignment.parcelId &&
          distM > GEOFENCE_ENTER_TOLERANCE_M &&
          distM <= GEOFENCE_APPROACH_M
        ) {
          const approachedResult = await this.drizzleProvider.db.execute(sql`
            SELECT 1
            FROM geofence_events
            WHERE machine_id = ${assignment.machineId}::uuid
              AND geofence_id = ${geofenceId}::uuid
              AND assignment_id = ${assignment.assignmentId}::uuid
              AND event_type = 'approach'
            LIMIT 1
          `);
          const alreadyApproached = (approachedResult as unknown as unknown[]).length > 0;
          if (!alreadyApproached) {
            await this.recordEvent(
              assignment.machineId,
              assignment.assignmentId,
              geofenceType,
              geofenceId,
              'approach',
              pos.lat,
              pos.lon,
            );
            await this.notifyLoadersApproaching(
              assignment.parcelId,
              assignment.machineId,
              assignment.parcelName,
              assignment.assignmentId,
              today,
              assignment.organizationId,
              Math.round(distM),
            );
          }
        }

        // Truck-approaching-DEPOT alert: when a truck en route nears its
        // destination depot (within APPROACH_M but not yet arrived past the enter
        // tolerance), tell the depot operator(s) — ONCE. Same fire-once guard as
        // the parcel approach: a single 'approach' row per (truck, depot,
        // assignment). Gated to in_transit so it only fires while actually driving
        // to the depot, not while the truck still sits at a nearby loader.
        if (
          geofenceType === 'deposit' &&
          assignment.machineType === 'truck' &&
          assignment.tripStatus === 'in_transit' &&
          distM > GEOFENCE_ENTER_TOLERANCE_M &&
          distM <= GEOFENCE_APPROACH_M
        ) {
          const approachedResult = await this.drizzleProvider.db.execute(sql`
            SELECT 1
            FROM geofence_events
            WHERE machine_id = ${assignment.machineId}::uuid
              AND geofence_id = ${geofenceId}::uuid
              AND assignment_id = ${assignment.assignmentId}::uuid
              AND event_type = 'approach'
            LIMIT 1
          `);
          const alreadyApproached = (approachedResult as unknown as unknown[]).length > 0;
          if (!alreadyApproached) {
            await this.recordEvent(
              assignment.machineId,
              assignment.assignmentId,
              geofenceType,
              geofenceId,
              'approach',
              pos.lat,
              pos.lon,
            );
            await this.notifyDepotOperatorsApproaching(
              geofenceId,
              assignment.machineId,
              assignment.tripId,
              Math.round(distM),
              assignment.organizationId,
            );
          }
        }

        // 4. Get last known geofence event for this machine + geofence pair.
        // Restricted to enter/exit so a separately-recorded 'approach' row
        // (truck-approaching alert, fire-once) never flips the hysteresis.
        const lastEventResult = await this.drizzleProvider.db.execute(sql`
        SELECT event_type AS "eventType"
        FROM geofence_events
        WHERE machine_id = ${assignment.machineId}::uuid
          AND geofence_id = ${geofenceId}::uuid
          AND assignment_id = ${assignment.assignmentId}::uuid
          AND event_type IN ('enter', 'exit')
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

        // Baler diagnostics — exact distance + transition decision per check, so
        // a field test shows whether ENTER/EXIT fires and why (grep logs:flow).
        if (geofenceType === 'parcel' && assignment.machineType === 'baler') {
          this.winston.log('flow', 'geofence baler: parcel proximity check', {
            context: 'GeofenceService',
            machineId: assignment.machineId,
            parcelId: assignment.parcelId,
            assignmentId: assignment.assignmentId,
            assignedUserId: assignment.assignedUserId,
            distM: Math.round(distM),
            enterTolM: GEOFENCE_ENTER_TOLERANCE_M,
            exitTolM: GEOFENCE_EXIT_TOLERANCE_M,
            wasInside,
            isInside,
            transition: isInside && !wasInside ? 'ENTER' : !isInside && wasInside ? 'EXIT' : 'none',
          });
        }

        // Push recipient. Truck tasks usually have no assigned_user_id (the
        // driver lives on the trip), and baler/loader tasks are often unassigned
        // too — the operator is linked to the MACHINE (users.assigned_machine_id),
        // not the daily task. Fall back to the trip driver for trucks and to the
        // machine's operator for baler/loader, so the geofence prompts (start-work
        // on enter, production on exit) actually reach someone.
        const recipientId =
          assignment.machineType === 'truck'
            ? (assignment.assignedUserId ?? assignment.tripDriverId)
            : (assignment.assignedUserId ?? assignment.machineOperatorId);

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

          // Baler enter: even the machine-operator fallback found no recipient —
          // log it so a field test surfaces the gap (no operator on task/machine).
          if (geofenceType === 'parcel' && assignment.machineType === 'baler' && !recipientId) {
            this.winston.log(
              'flow',
              'geofence baler: ENTER but NO recipient (no operator on task or machine) — no start-work push',
              {
                context: 'GeofenceService',
                machineId: assignment.machineId,
                parcelId: assignment.parcelId,
                assignmentId: assignment.assignmentId,
              },
            );
          }

          // No machine auto-flips to in_progress on a geofence enter anymore.
          // Every machine type now confirms the entry overlay first
          // (POST /notifications/confirm-parcel-entry) — so a mere drive-through
          // does not silently start the task (audit #2). The push below drives
          // that confirmation overlay, with copy tailored per machine type.
          if (geofenceType === 'parcel' && recipientId && assignment.parcelId) {
            const parcelRef = {
              id: assignment.parcelId,
              code: assignment.parcelCode ?? assignment.parcelName ?? '—',
              name: assignment.parcelName,
            };
            if (assignment.machineType === 'baler') {
              // T6 enter — rich 10 s auto-confirm overlay with crop context.
              await this.notificationsService.sendBalerFieldEntryConfirm(
                recipientId,
                assignment.assignmentId,
                { ...parcelRef, cropType: assignment.cropType },
              );
              this.winston.log('flow', 'geofence baler: ENTER → start-work push sent', {
                context: 'GeofenceService',
                machineId: assignment.machineId,
                parcelId: assignment.parcelId,
                assignmentId: assignment.assignmentId,
                recipientId,
              });
            } else if (assignment.machineType === 'loader') {
              await this.notificationsService.sendFieldEntryConfirm(
                recipientId,
                assignment.assignmentId,
                parcelRef,
                'load',
              );
            } else if (assignment.machineType === 'truck') {
              await this.notificationsService.sendFieldEntryConfirm(
                recipientId,
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

          // Notify driver when truck enters deposit geofence. Uses the
          // trip-driver fallback so it fires even when the truck task has no
          // assigned_user_id (the common case — this was the silent gap).
          if (geofenceType === 'deposit' && recipientId) {
            await this.notificationsService.sendPush(
              recipientId,
              'Ai ajuns la depozit',
              'Confirmă sosirea ca să închei cursa.',
              {
                type: 'deposit_entry',
                assignmentId: assignment.assignmentId,
                tripId: assignment.tripId,
              },
            );
          }

          // Also notify the depot operator(s) assigned to this destination that a
          // truck has arrived and is awaiting their bale confirmation. Best-effort,
          // org-scoped fan-out — mirrors notifyLoadersAtParcel.
          if (geofenceType === 'deposit') {
            await this.notifyDepotOperatorsAtArrival(
              geofenceId,
              assignment.machineId,
              assignment.tripId,
              assignment.organizationId,
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
            recipientId &&
            assignment.parcelId
          ) {
            await this.notificationsService.sendBalerFieldExitProduction(
              recipientId,
              assignment.assignmentId,
              {
                id: assignment.parcelId,
                code: assignment.parcelCode ?? assignment.parcelName ?? '—',
                name: assignment.parcelName,
              },
            );
            this.winston.log('flow', 'geofence baler: EXIT → production push sent', {
              context: 'GeofenceService',
              machineId: assignment.machineId,
              parcelId: assignment.parcelId,
              assignmentId: assignment.assignmentId,
              recipientId,
            });
          } else if (geofenceType === 'parcel' && assignment.machineType === 'baler') {
            // EXIT detected but the production push was skipped — surface why.
            this.winston.log('flow', 'geofence baler: EXIT but production push SKIPPED', {
              context: 'GeofenceService',
              machineId: assignment.machineId,
              parcelId: assignment.parcelId,
              assignmentId: assignment.assignmentId,
              reason: !recipientId ? 'no operator (task/machine)' : 'no parcelId',
            });
          }

          // Loader exit — only if the loader actually worked this field
          // (in_progress, i.e. it confirmed the entry overlay). Ask whether the
          // field is fully loaded/done; "Da" reconciles produced vs loaded
          // bales via POST /notifications/confirm-parcel-loaded (audit #1).
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'loader' &&
            recipientId &&
            assignment.parcelId &&
            assignment.status === 'in_progress'
          ) {
            await this.notificationsService.sendLoaderFieldExitConfirm(
              recipientId,
              assignment.assignmentId,
              { id: assignment.parcelId, name: assignment.parcelName },
            );
          }

          // Truck exit from the source parcel — if the trip is loaded and DEPART
          // is a valid transition, prompt the driver to start the departure flow
          // (audit #3). We never auto-fire DEPART: it needs the driver signature
          // (CMR), which the driver supplies in the departure-flow screen this
          // push routes to.
          if (
            geofenceType === 'parcel' &&
            assignment.machineType === 'truck' &&
            recipientId &&
            assignment.tripId &&
            assignment.tripStatus &&
            getAvailableTransitions(assignment.tripStatus as TripStatus).includes('DEPART')
          ) {
            await this.notificationsService.sendPush(
              recipientId,
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
   * Notify the depot operator(s) assigned to a destination depot that a truck has
   * arrived and is awaiting their bale confirmation. Fan-out to every
   * depot_manager linked via users.assigned_delivery_destination_id, scoped to the
   * truck's organization. Best-effort — push failures must not break the geofence
   * loop.
   */
  private async notifyDepotOperatorsAtArrival(
    destinationId: string,
    truckMachineId: string,
    tripId: string | null,
    orgId: string | null,
  ): Promise<void> {
    try {
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT
          u.id AS "userId",
          (SELECT registration_plate FROM machines WHERE id = ${truckMachineId}::uuid) AS "truckPlate"
        FROM users u
        WHERE u.assigned_delivery_destination_id = ${destinationId}::uuid
          AND u.role = 'depot_manager'::user_role
          AND u.deleted_at IS NULL
          AND u.organization_id IS NOT DISTINCT FROM ${orgId}::uuid
      `)) as unknown as { userId: string; truckPlate: string | null }[];

      if (rows.length === 0) return;

      const plate = rows[0]?.truckPlate ?? 'Un camion';

      await Promise.all(
        rows.map((row) =>
          this.notificationsService
            .sendPush(
              row.userId,
              'Camion sosit la depozit',
              `Camionul ${plate} a sosit. Confirmă baloții pentru a descărca.`,
              {
                type: 'depot_truck_arrived',
                destinationId,
                truckMachineId,
                tripId,
              },
            )
            .catch(() => {
              // Best-effort — push failures must not break the geofence loop.
            }),
        ),
      );

      this.winston.log(
        'flow',
        `Notified ${rows.length} depot operator(s) of truck ${truckMachineId} at depot ${destinationId}`,
        {
          context: 'GeofenceService',
          truckMachineId,
          destinationId,
          operatorCount: rows.length,
        },
      );
    } catch (err) {
      this.winston.warn(`notifyDepotOperatorsAtArrival failed (depot ${destinationId})`, {
        context: 'GeofenceService',
        destinationId,
        truckMachineId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /**
   * One-time heads-up to the depot operator(s) that a truck en route is
   * approaching their depot (within APPROACH_M, ~5 km). Fired once per
   * (truck, depot, assignment) — the fire-once guard lives in the caller via a
   * single 'approach' geofence_events row. Best-effort, org-scoped fan-out.
   */
  private async notifyDepotOperatorsApproaching(
    destinationId: string,
    truckMachineId: string,
    tripId: string | null,
    distanceM: number,
    orgId: string | null,
  ): Promise<void> {
    try {
      const rows = (await this.drizzleProvider.db.execute(sql`
        SELECT
          u.id AS "userId",
          (SELECT registration_plate FROM machines WHERE id = ${truckMachineId}::uuid) AS "truckPlate"
        FROM users u
        WHERE u.assigned_delivery_destination_id = ${destinationId}::uuid
          AND u.role = 'depot_manager'::user_role
          AND u.deleted_at IS NULL
          AND u.organization_id IS NOT DISTINCT FROM ${orgId}::uuid
      `)) as unknown as { userId: string; truckPlate: string | null }[];

      if (rows.length === 0) return;

      const plate = rows[0]?.truckPlate ?? 'Un camion';
      const km = (distanceM / 1000).toFixed(distanceM < 1000 ? 1 : 0);

      await Promise.all(
        rows.map((row) =>
          this.notificationsService
            .sendPush(
              row.userId,
              'Camion în apropiere',
              `Camionul ${plate} se apropie de depozit (~${km} km).`,
              {
                type: 'depot_truck_approaching',
                destinationId,
                truckMachineId,
                tripId,
                distanceM,
              },
            )
            .catch(() => {
              // Best-effort — push failures must not break the geofence loop.
            }),
        ),
      );

      this.winston.log(
        'flow',
        `Notified ${rows.length} depot operator(s) that truck ${truckMachineId} is approaching depot ${destinationId} (${distanceM} m)`,
        {
          context: 'GeofenceService',
          truckMachineId,
          destinationId,
          distanceM,
          operatorCount: rows.length,
        },
      );
    } catch (err) {
      this.winston.warn(`notifyDepotOperatorsApproaching failed (depot ${destinationId})`, {
        context: 'GeofenceService',
        destinationId,
        truckMachineId,
        err: err instanceof Error ? { message: err.message } : err,
      });
    }
  }

  /**
   * Notify the loader/baler operators waiting at a parcel that the truck they
   * expect is approaching (within APPROACH_M). Mirrors notifyLoadersAtParcel's
   * org-scoped fan-out but carries the plate so the mobile overlay can read it.
   * Best-effort: a missing assignment, push token, or Expo error never blocks
   * the geofence loop.
   */
  private async notifyLoadersApproaching(
    parcelId: string,
    truckMachineId: string,
    parcelName: string | null,
    truckAssignmentId: string,
    today: string,
    orgId: string | null,
    distanceM: number,
  ): Promise<void> {
    try {
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

      await Promise.all(
        loaderRows.map((row) =>
          this.notificationsService
            .sendPush(
              row.userId,
              'Camion în apropiere',
              `Camionul ${plate} — șoferul se apropie spre tine.`,
              {
                type: 'truck_approaching_loader',
                assignmentId: row.assignmentId,
                truckMachineId,
                truckAssignmentId,
                truckPlate: plate,
                parcelName,
                distanceM,
              },
            )
            .catch(() => {
              // Best-effort — push failures must not break the geofence loop.
            }),
        ),
      );

      this.winston.log(
        'flow',
        `Notified ${loaderRows.length} loader(s) that truck ${truckMachineId} is approaching parcel ${parcelId} (${distanceM} m)`,
        {
          context: 'GeofenceService',
          truckMachineId,
          parcelId,
          distanceM,
          loaderCount: loaderRows.length,
        },
      );
    } catch (err) {
      this.winston.warn(`notifyLoadersApproaching failed (parcel ${parcelId})`, {
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
    eventType: 'enter' | 'exit' | 'approach',
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
