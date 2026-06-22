import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { QUEUE_OTA_DEPLOY } from '../jobs/queues';
import { FleetService } from './fleet.service';

@Injectable()
@Processor(QUEUE_OTA_DEPLOY)
export class OtaDeployProcessor extends WorkerHost {
  constructor(
    private readonly fleetService: FleetService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job<{ deploymentId: string }>): Promise<void> {
    const { deploymentId } = job.data;
    this.winston.log('flow', 'OTA deploy job started', {
      context: 'OtaDeployProcessor',
      jobId: job.id,
      deploymentId,
    });

    try {
      await this.fleetService.activateDeployment(deploymentId);
      this.winston.log('flow', 'OTA deploy job completed', {
        context: 'OtaDeployProcessor',
        jobId: job.id,
        deploymentId,
      });
    } catch (err) {
      this.winston.error('OTA deploy job failed', {
        context: 'OtaDeployProcessor',
        jobId: job.id,
        deploymentId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      throw err;
    }
  }
}
