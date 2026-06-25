import { Injectable, Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Job } from 'bullmq';
import { QUEUE_PIN_REGEN } from '../jobs/queues';
import { BeneficiariesService } from './beneficiaries.service';

@Injectable()
@Processor(QUEUE_PIN_REGEN)
export class PinRegenProcessor extends WorkerHost {
  constructor(
    private readonly service: BeneficiariesService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'PIN regen job started', {
      context: 'PinRegenProcessor',
      jobId: job.id,
    });
    const count = await this.service.regenAllPins();
    this.winston.log('flow', `PIN regen job finished: ${count} beneficiaries updated`, {
      context: 'PinRegenProcessor',
      jobId: job.id,
      count,
    });
  }
}
