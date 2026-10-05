import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { MeteoDataService } from './meteo-data.service';
import { meteoJobsEnabled } from './meteo-access.service';
import { QUEUE_METEO_ENGINE } from './meteo.queues';

/** Debounced engine run for one drying clock; re-reads everything from the DB. */
@Injectable()
@Processor(QUEUE_METEO_ENGINE)
export class MeteoEngineProcessor extends WorkerHost {
  constructor(
    private readonly data: MeteoDataService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    if (!meteoJobsEnabled()) return;
    try {
      await this.data.computeEvent(job.data.eventId);
    } catch (err) {
      this.winston.error('Meteo engine job failed', {
        context: 'MeteoEngineProcessor',
        jobId: job.id,
        eventId: job.data.eventId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      throw err;
    }
  }
}
