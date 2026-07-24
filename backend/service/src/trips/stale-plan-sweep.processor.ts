import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { QUEUE_STALE_PLAN_SWEEP } from '../jobs/queues';
import { TripsService } from './trips.service';

/**
 * Daily sweep that auto-cancels own-fleet planned trips whose planned day has
 * already passed and that were never started. Without it an abandoned plan
 * lingers forever: the sync pull force-includes every non-terminal trip
 * (see sync.service `versionFilter`), so the plan stays glued to the driver's /
 * loader's phone day after day until something moves it to a terminal status —
 * and nothing ever did. Runs shortly after midnight Europe/Bucharest so the
 * previous operational day's un-started plans are gone by morning.
 */
@Injectable()
@Processor(QUEUE_STALE_PLAN_SWEEP)
export class StalePlanSweepProcessor extends WorkerHost {
  constructor(
    private readonly tripsService: TripsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'Stale-plan sweep job started', {
      context: 'StalePlanSweepProcessor',
      jobId: job.id,
    });

    try {
      const res = await this.tripsService.sweepStalePlannedTrips();
      this.winston.log(
        'flow',
        `Stale-plan sweep job finished: ${res.cancelled} cancelled, ${res.tasksRemoved} task(s) removed`,
        { context: 'StalePlanSweepProcessor', jobId: job.id, ...res },
      );
    } catch (err) {
      this.winston.error('Stale-plan sweep job failed', {
        context: 'StalePlanSweepProcessor',
        jobId: job.id,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      throw err;
    }
  }
}
