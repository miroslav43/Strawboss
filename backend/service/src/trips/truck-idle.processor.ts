import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { QUEUE_TRUCK_IDLE_CHECK } from '../jobs/queues';

function readIdleThresholdMin(): number {
  const raw = process.env.STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN;
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
}
const IDLE_THRESHOLD_MIN = readIdleThresholdMin();

/**
 * Plan C — periodic scan that detects trucks idle past the threshold and
 * creates a system alert + push to admins/dispatchers.
 *
 * Conditions for an alert:
 *  1. Last completed trip > IDLE_THRESHOLD_MIN ago.
 *  2. No open subsequent iteration (planned/loading/loaded/in_transit/
 *     arrived/delivering) on the same course.
 *  3. Source parcel still has remaining bales (produced - loaded > 0).
 *  4. No unacknowledged `truck_idle` alert exists for this truck in the
 *     last 60 min (dedup window).
 *
 * task_assignments.status is double-checked: if the truck has an active
 * task_assignment in status `in_progress`, we treat it as busy and skip
 * the alert (avoids false positives where the driver is just slow to
 * mark the next leg).
 */
@Injectable()
@Processor(QUEUE_TRUCK_IDLE_CHECK)
export class TruckIdleProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notificationsService: NotificationsService,
    private readonly alertsService: AlertsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'Truck-idle check job started', {
      context: 'TruckIdleProcessor',
      jobId: job.id,
      thresholdMin: IDLE_THRESHOLD_MIN,
    });

    const rows = (await this.drizzleProvider.db.execute(sql`
      WITH last_completed AS (
        SELECT DISTINCT ON (truck_id)
               truck_id, id AS trip_id,
               COALESCE(parent_trip_id, id) AS root_id,
               source_parcel_id, organization_id,
               completed_at
          FROM trips
         WHERE status = 'completed'::trip_status
           AND deleted_at IS NULL
           AND truck_id IS NOT NULL
         ORDER BY truck_id, completed_at DESC
      )
      SELECT
        lc.truck_id, lc.trip_id, lc.organization_id, lc.completed_at,
        m.internal_code AS truck_code,
        EXTRACT(EPOCH FROM (NOW() - lc.completed_at)) / 60.0 AS idle_minutes,
        (
          SELECT COUNT(*)::int FROM trips t2
           WHERE t2.deleted_at IS NULL
             AND (t2.parent_trip_id = lc.root_id OR t2.id = lc.root_id)
             AND t2.status IN (
               'planned'::trip_status, 'loading'::trip_status,
               'loaded'::trip_status, 'in_transit'::trip_status,
               'arrived'::trip_status, 'delivering'::trip_status
             )
        ) AS open_iterations,
        -- Scoped to the owning org's active season. This figure drives a push
        -- notification telling a driver there is still work on a field; without
        -- the window, a field finished last season would keep nagging forever.
        -- The correlated subquery on organizations is cheap (PK lookup, a
        -- handful of orgs) and keeps the whole thing one statement.
        COALESCE(
          (SELECT SUM(bp.bale_count) FROM bale_productions bp
            WHERE bp.parcel_id = lc.source_parcel_id AND bp.deleted_at IS NULL
              AND (o.active_season_year IS NULL
                   OR EXTRACT(YEAR FROM bp.production_date)::int = o.active_season_year)),
          0
        )::int
        - COALESCE(
          (SELECT SUM(bl.bale_count) FROM bale_loads bl
            WHERE bl.parcel_id = lc.source_parcel_id AND bl.deleted_at IS NULL
              AND (o.active_season_year IS NULL
                   OR EXTRACT(YEAR FROM (bl.loaded_at AT TIME ZONE 'Europe/Bucharest'))::int = o.active_season_year)),
          0
        )::int AS remaining_bales,
        (
          SELECT COUNT(*)::int FROM task_assignments ta
           WHERE ta.machine_id = lc.truck_id
             AND ta.deleted_at IS NULL
             AND ta.status = 'in_progress'::task_assignment_status
        ) AS active_tasks
      FROM last_completed lc
      JOIN machines m ON m.id = lc.truck_id AND m.deleted_at IS NULL
      -- LEFT so a trip with no organization (pre-multi-tenancy rows) still
      -- appears; o.active_season_year is then NULL, which the subqueries above
      -- read as "no season filter".
      LEFT JOIN organizations o ON o.id = lc.organization_id AND o.deleted_at IS NULL
      WHERE lc.completed_at < NOW() - (${IDLE_THRESHOLD_MIN} || ' minutes')::interval
    `)) as unknown as {
      truck_id: string;
      trip_id: string;
      organization_id: string | null;
      completed_at: string;
      truck_code: string;
      idle_minutes: number;
      open_iterations: number;
      remaining_bales: number;
      active_tasks: number;
    }[];

    let createdCount = 0;
    for (const r of rows) {
      // Skip when another iteration is already in flight.
      if (Number(r.open_iterations) > 0) continue;
      // Skip when the parcel is fully harvested+loaded.
      if (Number(r.remaining_bales) <= 0) continue;
      // Skip when the truck has an active task assignment (driver moving).
      if (Number(r.active_tasks) > 0) continue;

      // Dedup per idle EPISODE (the truck's last completed trip), NOT on a time
      // window or on acknowledgement. The 5-min scan previously re-created the
      // alert every 60 min while the truck stayed idle (and again right after an
      // admin acknowledged it), re-pushing to every admin/dispatcher hourly. Keying
      // on `completedAt` notifies exactly once per idle episode; a genuinely new
      // episode (truck completes another trip) carries a new completedAt.
      const existing = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM alerts
         WHERE machine_id = ${r.truck_id}::uuid
           AND organization_id IS NOT DISTINCT FROM ${r.organization_id}::uuid
           AND category = 'system'::alert_category
           AND data->>'kind' = 'truck_idle'
           AND data->>'completedAt' = ${r.completed_at}
         LIMIT 1
      `)) as unknown as { id: string }[];
      if (existing[0]) continue;

      const idleMinutes = Math.round(Number(r.idle_minutes));
      await this.alertsService.createTruckIdleAlert({
        truckId: r.truck_id,
        truckCode: r.truck_code,
        idleMinutes,
        completedAt: r.completed_at,
        orgId: r.organization_id,
      });
      await this.notificationsService.sendTruckIdleAdminAlert(
        r.organization_id,
        r.truck_id,
        r.truck_code,
        r.completed_at,
        idleMinutes,
      );
      this.winston.log('flow', `Truck idle alert: ${r.truck_code} idle ${idleMinutes}m`, {
        context: 'TruckIdleProcessor',
        truckId: r.truck_id,
        idleMinutes,
      });
      createdCount++;
    }

    this.winston.log(
      'flow',
      `Truck-idle check job finished: ${createdCount} alert(s) created from ${rows.length} candidate(s)`,
      {
        context: 'TruckIdleProcessor',
        jobId: job.id,
      },
    );
  }
}
