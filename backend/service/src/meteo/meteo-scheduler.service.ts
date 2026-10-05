import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { meteoJobsEnabled } from './meteo-access.service';
import {
  QUEUE_METEO_ALERTS,
  QUEUE_METEO_CLIMATE,
  QUEUE_METEO_FINGERPRINT,
  QUEUE_METEO_HOUSEKEEPING,
  QUEUE_METEO_INGEST,
  QUEUE_METEO_RETENTION,
} from './meteo.queues';

/**
 * Seeds the meteo repeating jobs. Deliberately NOT part of JobSchedulerService
 * (isolation), and a no-op unless METEO_JOBS_ENABLED === 'true': dev shares the
 * production database, so only the production stack may run these jobs.
 * upsertJobScheduler is idempotent across the Swarm replicas.
 */
@Injectable()
export class MeteoSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_METEO_INGEST) private readonly ingestQueue: Queue,
    @InjectQueue(QUEUE_METEO_HOUSEKEEPING) private readonly housekeepingQueue: Queue,
    @InjectQueue(QUEUE_METEO_FINGERPRINT) private readonly fingerprintQueue: Queue,
    @InjectQueue(QUEUE_METEO_RETENTION) private readonly retentionQueue: Queue,
    @InjectQueue(QUEUE_METEO_CLIMATE) private readonly climateQueue: Queue,
    @InjectQueue(QUEUE_METEO_ALERTS) private readonly alertsQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!meteoJobsEnabled()) {
      this.winston.info('Meteo jobs disabled (METEO_JOBS_ENABLED != true) — nothing scheduled', {
        context: 'MeteoSchedulerService',
      });
      return;
    }

    // Hourly at :20 — gives the model runs time to land after the top of the hour.
    await this.ingestQueue.upsertJobScheduler(
      'meteo-ingest-hourly',
      { pattern: '20 * * * *', tz: 'Europe/Bucharest' },
      { name: 'ingest', data: {} },
    );
    // Closes finished / expired drying clocks. Never creates one.
    await this.housekeepingQueue.upsertJobScheduler(
      'meteo-housekeeping-repeat',
      { every: 15 * 60_000 },
      { name: 'housekeeping', data: {} },
    );
    await this.fingerprintQueue.upsertJobScheduler(
      'meteo-fingerprint-repeat',
      { every: 15 * 60_000 },
      { name: 'fingerprint', data: {} },
    );
    await this.retentionQueue.upsertJobScheduler(
      'meteo-retention-daily',
      { pattern: '10 3 * * *', tz: 'Europe/Bucharest' },
      { name: 'retention', data: {} },
    );
    // Alerts at :40 — after the :20 ingest; the processor skips orgs without alerts_enabled.
    await this.alertsQueue.upsertJobScheduler(
      'meteo-alerts-hourly',
      { pattern: '40 * * * *', tz: 'Europe/Bucharest' },
      { name: 'evaluate', data: {} },
    );
    // ERA5 normals fill + current-year daily actuals; the processor no-ops without an opted-in org.
    await this.climateQueue.upsertJobScheduler(
      'meteo-climate-daily',
      { pattern: '30 4 * * *', tz: 'Europe/Bucharest' },
      { name: 'daily', data: {} },
    );

    this.winston.info(
      'Meteo repeating jobs seeded: ingest (hourly :20), housekeeping (15m), fingerprint (15m), retention (daily 03:10), alerts (hourly :40), climate (daily 04:30)',
      { context: 'MeteoSchedulerService' },
    );
  }
}
