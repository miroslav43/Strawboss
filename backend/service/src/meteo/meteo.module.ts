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
import { NotificationsModule } from '../notifications/notifications.module';
import { MeteoBudgetService } from './weather/meteo-budget.service';
import { MeteoWeatherCacheService } from './weather/meteo-weather-cache.service';
import { MeteoUpstreamService } from './weather/meteo-upstream.service';
import { MeteoWeatherService } from './weather/meteo-weather.service';
import { MeteoFarmWeatherService } from './weather/meteo-farm-weather.service';
import { MeteoWeatherController } from './weather/meteo-weather.controller';
import { MeteoClimateService } from './climate/meteo-climate.service';
import { MeteoClimateProcessor } from './climate/meteo-climate.processor';
import { MeteoAlertsService } from './alerts/meteo-alerts.service';
import { MeteoAlertNotifierService } from './alerts/meteo-alert-notifier.service';
import { MeteoAlertsProcessor } from './alerts/meteo-alerts.processor';
import { MeteoAlertsController } from './alerts/meteo-alerts.controller';
import { MeteoClimateController } from './climate/meteo-climate.controller';
import {
  QUEUE_METEO_ALERTS,
  QUEUE_METEO_CLIMATE,
  QUEUE_METEO_ENGINE,
  QUEUE_METEO_FINGERPRINT,
  QUEUE_METEO_HOUSEKEEPING,
  QUEUE_METEO_INGEST,
  QUEUE_METEO_RETENTION,
} from './meteo.queues';

/**
 * Isolated baling-window module. DatabaseModule, FeaturesModule, SeasonsModule,
 * RedisModule and MessagingModule are @Global. NotificationsModule is imported
 * only for the weather-alert push (nothing imports MeteoModule, so no cycle).
 * The BullMQ connection comes from JobsModule's forRoot.
 */
@Module({
  imports: [
    NotificationsModule,
    BullModule.registerQueue(
      { name: QUEUE_METEO_INGEST },
      { name: QUEUE_METEO_ENGINE },
      { name: QUEUE_METEO_HOUSEKEEPING },
      { name: QUEUE_METEO_FINGERPRINT },
      { name: QUEUE_METEO_RETENTION },
      { name: QUEUE_METEO_CLIMATE },
      { name: QUEUE_METEO_ALERTS },
    ),
  ],
  controllers: [MeteoController, MeteoWeatherController, MeteoClimateController, MeteoAlertsController],
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
    MeteoBudgetService,
    MeteoWeatherCacheService,
    MeteoUpstreamService,
    MeteoWeatherService,
    MeteoFarmWeatherService,
    MeteoClimateService,
    MeteoClimateProcessor,
    MeteoAlertsService,
    MeteoAlertNotifierService,
    MeteoAlertsProcessor,
  ],
})
export class MeteoModule {}
