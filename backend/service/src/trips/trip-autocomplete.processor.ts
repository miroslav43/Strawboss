import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { QUEUE_TRIP_AUTOCOMPLETE } from '../jobs/queues';

/**
 * Deliberate NO-OP kept for exactly one release.
 *
 * This used to be a delayed job that auto-completed an auxiliary trip 5
 * minutes after it was loaded, regardless of whether anything had actually
 * arrived anywhere (`TripsService.autoCompleteAuxiliary`, now removed). That
 * timer is gone: an aux trip now only completes when the external driver
 * uploads the arrival CMR (`TripsService.completeAuxiliaryOnArrivalCmr`), or an
 * admin force-completes it with a reason.
 *
 * At the moment this ships, BullMQ may still be holding delayed jobs
 * (`aux-autocomplete-<tripId>`) that were scheduled by the old code before the
 * deploy. Left unhandled, those would fire post-deploy and silently complete
 * trips nobody actually finished. Logging and discarding them here is the
 * deploy-safety net; this whole file (and QUEUE_TRIP_AUTOCOMPLETE) can be
 * deleted once they've all drained (~5 minutes after the release lands).
 */
@Injectable()
@Processor(QUEUE_TRIP_AUTOCOMPLETE)
export class TripAutocompleteProcessor extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger) {
    super();
  }

  async process(job: Job<{ tripId: string; orgId: string | null }>): Promise<void> {
    this.winston.log(
      'flow',
      'Aux auto-complete job: no-op (superseded by arrival-CMR completion)',
      {
        context: 'TripAutocompleteProcessor',
        jobId: job.id,
        tripId: job.data.tripId,
      },
    );
  }
}
