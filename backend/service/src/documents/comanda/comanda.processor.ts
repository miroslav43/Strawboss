import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ComandaService } from './comanda.service';
import { QUEUE_COMANDA_GENERATION } from '../../jobs/queues';

@Processor(QUEUE_COMANDA_GENERATION)
export class ComandaProcessor extends WorkerHost {
  private readonly logger = new Logger(ComandaProcessor.name);

  constructor(
    private readonly comandaService: ComandaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {
    super();
  }

  async process(job: Job<{ requestId: string; orgId: string }>): Promise<void> {
    try {
      await this.comandaService.generateComanda(job.data.orgId, job.data.requestId);
    } catch (err) {
      this.logger.error(
        `Comandă generation failed for request ${job.data.requestId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err; // let BullMQ mark the job failed / retry
    }
  }
}
