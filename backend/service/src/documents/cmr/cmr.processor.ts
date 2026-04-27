import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { CmrService } from './cmr.service';
import { QUEUE_CMR_GENERATION } from '../../jobs/queues';

@Processor(QUEUE_CMR_GENERATION)
export class CmrProcessor extends WorkerHost {
  private readonly logger = new Logger(CmrProcessor.name);

  constructor(
    private readonly cmrService: CmrService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {
    super();
  }

  async process(job: Job<{ tripId: string }>): Promise<void> {
    this.winston.log('flow', `CMR generation job started`, {
      context: 'CmrProcessor',
      tripId: job.data.tripId,
      jobId: job.id,
    });

    try {
      await this.cmrService.generateCmr(job.data.tripId);
    } catch (err) {
      this.logger.error(
        `CMR generation failed for trip ${job.data.tripId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err; // Let BullMQ mark the job as failed
    }

    this.winston.log('flow', `CMR generation job completed`, {
      context: 'CmrProcessor',
      tripId: job.data.tripId,
      jobId: job.id,
    });
  }
}
