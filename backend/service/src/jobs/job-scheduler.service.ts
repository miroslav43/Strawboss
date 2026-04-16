import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import {
  QUEUE_GEOFENCE_CHECK,
  QUEUE_ALERT_EVALUATION,
  QUEUE_RECONCILIATION,
  QUEUE_SYNC_CLEANUP,
} from './queues';

/**
 * Seeds BullMQ repeating jobs on application startup.
 * Uses upsertJobScheduler so it's safe to call on every restart.
 */
@Injectable()
export class JobSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_GEOFENCE_CHECK) private readonly geofenceQueue: Queue,
    @InjectQueue(QUEUE_ALERT_EVALUATION) private readonly alertQueue: Queue,
    @InjectQueue(QUEUE_RECONCILIATION) private readonly reconciliationQueue: Queue,
    @InjectQueue(QUEUE_SYNC_CLEANUP) private readonly syncCleanupQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async onModuleInit() {
    this.winston.info('Seeding repeating BullMQ jobs...', {
      context: 'JobSchedulerService',
    });

    await this.geofenceQueue.upsertJobScheduler(
      'geofence-repeat',
      { every: 5 * 60_000 },
      { name: 'check', data: {} },
    );

    await this.alertQueue.upsertJobScheduler(
      'alert-repeat',
      { every: 15 * 60_000 },
      { name: 'evaluate', data: {} },
    );

    await this.reconciliationQueue.upsertJobScheduler(
      'reconciliation-repeat',
      { every: 60 * 60_000 },
      { name: 'reconcile', data: {} },
    );

    await this.syncCleanupQueue.upsertJobScheduler(
      'sync-cleanup-repeat',
      { pattern: '0 2 * * *' },
      { name: 'cleanup', data: {} },
    );

    this.winston.info('Repeating jobs seeded: geofence (5m), alerts (15m), reconciliation (1h), sync-cleanup (daily 02:00)', {
      context: 'JobSchedulerService',
    });
  }
}
