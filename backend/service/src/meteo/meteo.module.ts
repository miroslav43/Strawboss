import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MeteoController } from './meteo.controller';
import { MeteoService } from './meteo.service';
import { MeteoClient } from './meteo-client';
import { MeteoAccessService } from './meteo-access.service';
import { MeteoDataService } from './meteo-data.service';
import { MeteoSchedulerService } from './meteo-scheduler.service';
import { MeteoIngestProcessor } from './meteo-ingest.processor';
import { MeteoEngineProcessor } from './meteo-engine.processor';
import { MeteoHousekeepingProcessor } from './meteo-housekeeping.processor';
import { MeteoFingerprintProcessor } from './meteo-fingerprint.processor';
import { MeteoRetentionProcessor } from './meteo-retention.processor';
import {
  QUEUE_METEO_ENGINE,
  QUEUE_METEO_FINGERPRINT,
  QUEUE_METEO_HOUSEKEEPING,
  QUEUE_METEO_INGEST,
  QUEUE_METEO_RETENTION,
} from './meteo.queues';

/**
 * Isolated baling-window module. DatabaseModule, FeaturesModule and
 * SeasonsModule are @Global; NotificationsModule is deliberately NOT imported
 * (no push in the MVP). The BullMQ connection comes from JobsModule's forRoot.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_METEO_INGEST },
      { name: QUEUE_METEO_ENGINE },
      { name: QUEUE_METEO_HOUSEKEEPING },
      { name: QUEUE_METEO_FINGERPRINT },
      { name: QUEUE_METEO_RETENTION },
    ),
  ],
  controllers: [MeteoController],
  providers: [
    MeteoClient,
    MeteoAccessService,
    MeteoDataService,
    MeteoService,
    MeteoSchedulerService,
    MeteoIngestProcessor,
    MeteoEngineProcessor,
    MeteoHousekeepingProcessor,
    MeteoFingerprintProcessor,
    MeteoRetentionProcessor,
  ],
})
export class MeteoModule {}
