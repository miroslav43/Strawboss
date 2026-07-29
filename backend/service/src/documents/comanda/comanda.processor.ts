import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ComandaService } from './comanda.service';
import { QUEUE_COMANDA_GENERATION } from '../../jobs/queues';
import { isFeatureEnabled } from '@strawboss/types';
import { FeaturesService } from '../../features/features.service';

@Processor(QUEUE_COMANDA_GENERATION)
export class ComandaProcessor extends WorkerHost {
  private readonly logger = new Logger(ComandaProcessor.name);

  constructor(
    private readonly comandaService: ComandaService,
    private readonly features: FeaturesService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {
    super();
  }

  async process(job: Job<{ requestId: string; orgId: string }>): Promise<void> {
    /*
     * Return, do not throw. This queue is one job per request per org, but a
     * throw feeds BullMQ's retry (attempts: 2) and lands the job in `failed` —
     * noise for a configuration decision that will never succeed. The enqueue
     * side is already best-effort and the request row is committed before it,
     * so nothing is stranded by skipping.
     */
    if (
      !isFeatureEnabled(
        await this.features.getDisabledForOrg(job.data.orgId),
        'documents.comanda',
      )
    ) {
      return;
    }
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
