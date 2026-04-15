import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';

interface ActiveAssignment {
  assignmentId: string;
  machineId: string;
  machineType: string;
  parcelId: string | null;
  destinationId: string | null;
  assignedUserId: string | null;
  parcelName: string | null;
  status: string;
}

interface MachinePosition {
  machineId: string;
  lat: number;
  lon: number;
}

interface GeofenceCheck {
  machineId: string;
  geofenceType: 'parcel' | 'deposit';
  geofenceId: string;
  isInside: boolean;
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
    const today = new Date().toISOString().split('T')[0];

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
        ta.status
      FROM task_assignments ta
      JOIN machines m ON m.id = ta.machine_id
      LEFT JOIN parcels p ON p.id = ta.parcel_id
      WHERE ta.assignment_date = ${today}
        AND ta.deleted_at IS NULL
        AND ta.status IN ('available', 'in_progress')
    `);
    const assignments = assignmentsResult as unknown as ActiveAssignment[];

    if (assignments.length === 0) return;

    // 2. Get unique machine IDs and their latest GPS positions
    const machineIds = [...new Set(assignments.map((a) => a.machineId))];
    const positionsResult = await this.drizzleProvider.db.execute(sql`
      SELECT DISTINCT ON (machine_id)
        machine_id AS "machineId",
        lat,
        lon
      FROM machine_location_events
      WHERE machine_id = ANY(${machineIds}::uuid[])
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

      // Determine which geofence to check
      const geofenceId = assignment.parcelId ?? assignment.destinationId;
      if (!geofenceId) continue;

      const geofenceType: 'parcel' | 'deposit' = assignment.parcelId
        ? 'parcel'
        : 'deposit';

      const table = geofenceType === 'parcel' ? 'parcels' : 'delivery_destinations';

      // Check ST_Contains
      const containsResult = await this.drizzleProvider.db.execute(sql`
        SELECT ST_Contains(
          boundary,
          ST_SetSRID(ST_MakePoint(${pos.lon}, ${pos.lat}), 4326)
        ) AS "isInside"
        FROM ${sql.raw(table)}
        WHERE id = ${geofenceId}::uuid
          AND boundary IS NOT NULL
      `);
      const check = (containsResult as unknown as GeofenceCheck[])[0];
      if (!check) continue;

      // 4. Get last known geofence event for this machine + geofence pair
      const lastEventResult = await this.drizzleProvider.db.execute(sql`
        SELECT event_type AS "eventType"
        FROM geofence_events
        WHERE machine_id = ${assignment.machineId}::uuid
          AND geofence_id = ${geofenceId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const lastEvent = (lastEventResult as unknown as LastEvent[])[0];
      const wasInside = lastEvent?.eventType === 'enter';

      // 5. Detect transitions
      if (check.isInside && !wasInside) {
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

        // Update assignment status to in_progress
        if (assignment.status === 'available') {
          await this.drizzleProvider.db.execute(sql`
            UPDATE task_assignments
            SET status = 'in_progress'::task_assignment_status,
                actual_start = now(),
                updated_at = now()
            WHERE id = ${assignment.assignmentId}::uuid
          `);
          this.winston.log(
            'flow',
            `Machine ${assignment.machineId} entered ${geofenceType} ${geofenceId} — assignment ${assignment.assignmentId} → in_progress`,
            {
              context: 'GeofenceService',
              machineId: assignment.machineId,
              geofenceType,
              geofenceId,
              assignmentId: assignment.assignmentId,
              event: 'enter',
            },
          );
        }
      } else if (!check.isInside && wasInside) {
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

        // If baler exits a parcel, send push notification to confirm
        if (
          geofenceType === 'parcel' &&
          assignment.machineType === 'baler' &&
          assignment.assignedUserId
        ) {
          await this.notificationsService.sendGeofenceExitNotification(
            assignment.assignmentId,
            assignment.parcelName ?? 'Unknown',
            assignment.assignedUserId,
          );
        }
      }
    }
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
