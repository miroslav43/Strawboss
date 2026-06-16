import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ReconciliationService } from './reconciliation.service';
import { AlertsService } from '../alerts/alerts.service';
import { evaluateAlerts } from '@strawboss/domain';
import { QUEUE_RECONCILIATION } from '../jobs/queues';

@Injectable()
@Processor(QUEUE_RECONCILIATION)
export class ReconciliationProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly reconciliationService: ReconciliationService,
    private readonly alertsService: AlertsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  /**
   * Runs periodically (hourly). Processes all active parcels and machines.
   */
  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'Reconciliation job started', {
      context: 'ReconciliationProcessor',
      jobId: job.id,
    });

    // Recompute GPS route distance for recently-arrived trips first, so fuel
    // reconciliation below sees pings that synced late from drivers' phones.
    try {
      const updated = await this.reconciliationService.recomputeRecentTripDistances();
      this.winston.log('flow', `Recomputed gps_distance_km for ${updated} recent trip(s)`, {
        context: 'ReconciliationProcessor',
        jobId: job.id,
      });
    } catch (err: unknown) {
      this.winston.error('GPS distance recompute failed', {
        context: 'ReconciliationProcessor',
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }

    // Reconcile bales for all active parcels
    const parcelsResult = await this.drizzleProvider.db.execute(
      sql`SELECT id, organization_id FROM parcels WHERE is_active = true AND deleted_at IS NULL`,
    );
    const parcels = parcelsResult as unknown as { id: string; organization_id: string | null }[];

    for (const parcel of parcels) {
      try {
        const result = await this.reconciliationService.reconcileBalesForParcel(parcel.id);
        // Only alert on the "impossible" over-counts (loaded > produced or
        // delivered > loaded) — these always indicate a data error worth
        // surfacing. Mid-harvest shortfalls (loaded < produced) are expected
        // work-in-progress and must NOT spam an alert every hour. createFromDraft
        // dedups per parcel while the alert stays unacknowledged.
        const overCount = result.loadedVsProducedDiff > 0 || result.deliveredVsLoadedDiff > 0;
        if (overCount && parcel.organization_id) {
          const drafts = evaluateAlerts({ baleReconciliation: result });
          for (const draft of drafts) {
            await this.alertsService.createFromDraft(draft, parcel.organization_id);
          }
        }
      } catch (err: unknown) {
        this.winston.error(`Bale reconciliation failed for parcel ${parcel.id}`, {
          context: 'ReconciliationProcessor',
          parcelId: parcel.id,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
      }
    }

    // Reconcile fuel for all active machines (trucks)
    const machinesResult = await this.drizzleProvider.db.execute(
      sql`SELECT id, organization_id FROM machines
          WHERE machine_type = 'truck' AND is_active = true AND deleted_at IS NULL`,
    );
    const machines = machinesResult as unknown as { id: string; organization_id: string | null }[];

    for (const machine of machines) {
      try {
        const fuelResult = await this.reconciliationService.reconcileFuelForMachine(machine.id);
        // Fuel reconciliation is a coarse lifetime heuristic (0.35 L/km, ±20%)
        // whose distance/fuel scopes don't yet line up (distance counts only
        // delivered/completed trips, fuel counts every log) — so surface anomalies
        // in the flow log rather than raising noisy alerts. Promote to alerts once
        // the reconciliation window is tightened (bug #19).
        if (fuelResult.isAnomaly) {
          this.winston.log(
            'flow',
            `Fuel anomaly: machine ${machine.id} deviation ${fuelResult.deviationPercent.toFixed(1)}%`,
            {
              context: 'ReconciliationProcessor',
              machineId: machine.id,
              expectedFuelLiters: fuelResult.expectedFuelLiters,
              actualFuelLiters: fuelResult.actualFuelLiters,
              deviationPercent: fuelResult.deviationPercent,
            },
          );
        }
      } catch (err: unknown) {
        this.winston.error(`Fuel reconciliation failed for machine ${machine.id}`, {
          context: 'ReconciliationProcessor',
          machineId: machine.id,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
      }
    }

    this.winston.log('flow', 'Reconciliation job finished', {
      context: 'ReconciliationProcessor',
      jobId: job.id,
    });
  }
}
