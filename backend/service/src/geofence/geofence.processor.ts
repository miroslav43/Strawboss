import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { GeofenceService } from './geofence.service';
import { QUEUE_GEOFENCE_CHECK } from '../jobs/queues';

@Injectable()
@Processor(QUEUE_GEOFENCE_CHECK)
export class GeofenceProcessor extends WorkerHost {
  constructor(
    private readonly geofenceService: GeofenceService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.winston.log('flow', 'Geofence check job started', {
      context: 'GeofenceProcessor',
      jobId: job.id,
    });
    try {
      await this.geofenceService.checkMachinePositions();
      this.winston.log('flow', 'Geofence check job completed', {
        context: 'GeofenceProcessor',
        jobId: job.id,
      });
    } catch (err) {
      this.winston.error('Geofence check failed', {
        context: 'GeofenceProcessor',
        jobId: job.id,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      });
      throw err;
    }
  }
}
