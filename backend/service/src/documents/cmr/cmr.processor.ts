import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { CmrService } from './cmr.service';
import { QUEUE_CMR_GENERATION } from '../../jobs/queues';

@Processor(QUEUE_CMR_GENERATION)
export class CmrProcessor extends WorkerHost {
  constructor(
    private readonly cmrService: CmrService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job<{ tripId: string }>): Promise<void> {
    this.winston.log('flow', `CMR generation job started`, {
      context: 'CmrProcessor',
      tripId: job.data.tripId,
      jobId: job.id,
    });

    await this.cmrService.generateCmr(job.data.tripId);

    this.winston.log('flow', `CMR generation job completed`, {
      context: 'CmrProcessor',
      tripId: job.data.tripId,
      jobId: job.id,
    });
  }
}
