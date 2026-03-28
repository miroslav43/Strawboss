import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { DrizzleProvider } from '../database/drizzle.provider';
import { ReconciliationService } from './reconciliation.service';
import { QUEUE_RECONCILIATION } from '../jobs/queues';

@Injectable()
@Processor(QUEUE_RECONCILIATION)
export class ReconciliationProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly reconciliationService: ReconciliationService,
  ) {
    super();
  }

  /**
   * Runs periodically (hourly). Processes all active parcels and machines.
   */
  async process(_job: Job): Promise<void> {
    // Reconcile bales for all active parcels
    const parcelsResult = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM parcels WHERE is_active = true AND deleted_at IS NULL`,
    );
    const parcels = parcelsResult as unknown as { id: string }[];

    for (const parcel of parcels) {
      try {
        await this.reconciliationService.reconcileBalesForParcel(parcel.id);
      } catch (err: unknown) {
        console.error(
          `Bale reconciliation failed for parcel ${parcel.id}:`,
          err,
        );
      }
    }

    // Reconcile fuel for all active machines (trucks)
    const machinesResult = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM machines
          WHERE machine_type = 'truck' AND is_active = true AND deleted_at IS NULL`,
    );
    const machines = machinesResult as unknown as { id: string }[];

    for (const machine of machines) {
      try {
        await this.reconciliationService.reconcileFuelForMachine(machine.id);
      } catch (err: unknown) {
        console.error(
          `Fuel reconciliation failed for machine ${machine.id}:`,
          err,
        );
      }
    }
  }
}
