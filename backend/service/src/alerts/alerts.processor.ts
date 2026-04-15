import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { DrizzleProvider } from '../database/drizzle.provider';
import { AlertsService } from './alerts.service';
import {
  checkOdometerGpsDiscrepancy,
  checkTimingAnomaly,
  evaluateAlerts,
} from '@strawboss/domain';
import { QUEUE_ALERT_EVALUATION } from '../jobs/queues';

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
      const departureOdometer = trip.departure_odometer_km as number | null;
      const arrivalOdometer = trip.arrival_odometer_km as number | null;
      const gpsDistanceKm = trip.gps_distance_km as number | null;
      const departureAt = trip.departure_at as string | null;
      const arrivalAt = trip.arrival_at as string | null;
      const odometerDistanceKm = trip.odometer_distance_km as number | null;

      // Run odometer-GPS check if data is available
      const odometerGps =
        departureOdometer !== null &&
        arrivalOdometer !== null &&
        gpsDistanceKm !== null
          ? checkOdometerGpsDiscrepancy({
              departureOdometerKm: departureOdometer,
              arrivalOdometerKm: arrivalOdometer,
              gpsDistanceKm,
              tolerancePercent: 15,
            })
          : undefined;

      // Run timing check if data is available
      const distanceKm = odometerDistanceKm ?? gpsDistanceKm;
      let timingAnomaly;
      if (distanceKm !== null && departureAt && arrivalAt) {
        const departureTime = new Date(departureAt).getTime();
        const arrivalTime = new Date(arrivalAt).getTime();
        const durationMinutes = (arrivalTime - departureTime) / (1000 * 60);

        if (durationMinutes > 0) {
          timingAnomaly = checkTimingAnomaly({
            distanceKm,
            durationMinutes,
            maxSpeedKmh: 100,
            minSpeedKmh: 5,
          });
        }
      }

      // Evaluate alerts from the combined results
      const alertDrafts = evaluateAlerts({
        odometerGps,
        timingAnomaly,
        tripId: trip.id as string,
        machineId: trip.truck_id as string | undefined,
      });

      // Create alert records
      for (const draft of alertDrafts) {
        await this.alertsService.createFromDraft(draft);
      }
    }

    this.winston.log('flow', 'Alert evaluation job finished', {
      context: 'AlertsProcessor',
      jobId: job.id,
    });
  }
}
