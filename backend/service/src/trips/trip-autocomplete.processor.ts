import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { QUEUE_TRIP_AUTOCOMPLETE } from '../jobs/queues';
import { TripsService } from './trips.service';

/**
 * Delayed job that auto-completes an auxiliary trip a few minutes after it is
 * loaded. Scheduled from TripsService when an aux trip enters `loaded` (mobile
 * register-load or admin force-load), keyed by a deterministic jobId so a
 * repeat schedule replaces rather than duplicates. The service method is
 * idempotent — a no-op if the trip already left `loaded`.
 */
@Injectable()
@Processor(QUEUE_TRIP_AUTOCOMPLETE)
export class TripAutocompleteProcessor extends WorkerHost {
  constructor(
    private readonly tripsService: TripsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job<{ tripId: string; orgId: string | null }>): Promise<void> {
    const { tripId, orgId } = job.data;
    this.winston.log('flow', 'Aux auto-complete job started', {
      context: 'TripAutocompleteProcessor',
      jobId: job.id,
      tripId,
    });

    try {
      await this.tripsService.autoCompleteAuxiliary(tripId, orgId);
    } catch (err) {
      this.winston.error('Aux auto-complete job failed', {
        context: 'TripAutocompleteProcessor',
        jobId: job.id,
        tripId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      throw err;
    }
  }
}
