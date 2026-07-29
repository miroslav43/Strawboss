import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { DrizzleProvider } from '../database/drizzle.provider';
import { AlertsService } from './alerts.service';
import { checkTimingAnomaly, evaluateAlerts } from '@strawboss/domain';
import { AlertCategory, AlertSeverity } from '@strawboss/types';
import { QUEUE_ALERT_EVALUATION } from '../jobs/queues';

/**
 * How long an auxiliary trip may sit `loaded` with no arrival CMR before the
 * dispatcher gets an alert about it. Chosen wide enough that a normal
 * same-day or overnight haul never trips it — this is for a driver who
 * genuinely never uploaded, not one who's still on the road.
 */
const AUX_ARRIVAL_CMR_ALERT_AFTER_HOURS = 24;

@Injectable()
@Processor(QUEUE_ALERT_EVALUATION)
export class AlertsProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly alertsService: AlertsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'Alert evaluation job started', {
      context: 'AlertsProcessor',
      jobId: job.id,
    });
    // Fetch trips completed/arrived in the last hour
    const tripsResult = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM trips
          WHERE updated_at >= NOW() - INTERVAL '1 hour'
            AND status IN ('arrived', 'delivered', 'completed')
            AND deleted_at IS NULL`,
    );
    const trips = tripsResult as unknown as Record<string, unknown>[];

    for (const trip of trips) {
      const gpsDistanceKm = trip.gps_distance_km as number | null;
      const departureAt = trip.departure_at as string | null;
      const arrivalAt = trip.arrival_at as string | null;

      // Run timing/speed check using the GPS-derived route distance.
      let timingAnomaly;
      if (gpsDistanceKm !== null && departureAt && arrivalAt) {
        const departureTime = new Date(departureAt).getTime();
        const arrivalTime = new Date(arrivalAt).getTime();
        const durationMinutes = (arrivalTime - departureTime) / (1000 * 60);

        if (durationMinutes > 0) {
          timingAnomaly = checkTimingAnomaly({
            distanceKm: gpsDistanceKm,
            durationMinutes,
            maxSpeedKmh: 100,
            minSpeedKmh: 5,
          });
        }
      }

      // Evaluate alerts from the results
      const alertDrafts = evaluateAlerts({
        timingAnomaly,
        tripId: trip.id as string,
        machineId: trip.truck_id as string | undefined,
      });

      // Create alert records
      const tripOrgId = trip.organization_id as string;
      for (const draft of alertDrafts) {
        await this.alertsService.createFromDraft(draft, tripOrgId);
      }
    }

    await this.evaluateStaleAuxArrivalCmr();

    this.winston.log('flow', 'Alert evaluation job finished', {
      context: 'AlertsProcessor',
      jobId: job.id,
    });
  }

  /**
   * Auxiliary trips that have been sitting `loaded` for too long with no
   * arrival CMR — the driver never uploaded through the one-time link (lost
   * it, truck broke down, ignored the SMS). Since the loaded→completed timer
   * is gone (completion now only happens via that upload, or an admin
   * force-complete), this is the backstop that surfaces a transport that
   * would otherwise sit silently forever.
   *
   * No separate dedup bookkeeping needed: `AlertsService.createFromDraft`
   * already skips the insert when an unacknowledged alert for the same
   * (tripId, category) exists, so a persistent case raises exactly one alert
   * across every 15-minute run until a dispatcher acknowledges it.
   */
  private async evaluateStaleAuxArrivalCmr(): Promise<void> {
    const rows = (await this.drizzleProvider.db.execute(
      sql`SELECT id, organization_id, trip_number
          FROM trips
          WHERE is_auxiliary = true
            AND status = 'loaded'
            AND deleted_at IS NULL
            AND public_sign_token_used_at IS NULL
            AND loading_completed_at < NOW() - INTERVAL '${sql.raw(String(AUX_ARRIVAL_CMR_ALERT_AFTER_HOURS))} hours'`,
    )) as unknown as { id: string; organization_id: string | null; trip_number: string }[];

    for (const row of rows) {
      if (!row.organization_id) continue; // createFromDraft requires an org to scope the dedup query
      await this.alertsService.createFromDraft(
        {
          category: AlertCategory.anomaly,
          severity: AlertSeverity.medium,
          title: `CMR de sosire lipsă — cursa ${row.trip_number}`,
          description: `Cursa auxiliară ${row.trip_number} este încărcată de peste ${AUX_ARRIVAL_CMR_ALERT_AFTER_HOURS} ore și nu are CMR-ul de sosire încărcat. Verifică șoferul sau forțează finalizarea din pagina cursei.`,
          tripId: row.id,
          machineId: null,
          data: { rule: 'aux_arrival_cmr_missing' },
        },
        row.organization_id,
      );
    }
  }
}
