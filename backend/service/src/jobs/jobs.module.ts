import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { bullmqConnectionFromRedisUrl } from '../config/redis-bullmq';
import { JobSchedulerService } from './job-scheduler.service';
import {
  QUEUE_ALERT_EVALUATION,
  QUEUE_RECONCILIATION,
  QUEUE_CMR_GENERATION,
  QUEUE_SYNC_CLEANUP,
  QUEUE_GEOFENCE_CHECK,
  QUEUE_TRUCK_IDLE_CHECK,
  QUEUE_OTA_DEPLOY,
  QUEUE_PIN_REGEN,
  QUEUE_MESSAGE_SEND,
} from './queues';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379')!;
        return { connection: bullmqConnectionFromRedisUrl(redisUrl) };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_ALERT_EVALUATION },
      { name: QUEUE_RECONCILIATION },
      { name: QUEUE_CMR_GENERATION },
      { name: QUEUE_SYNC_CLEANUP },
      { name: QUEUE_GEOFENCE_CHECK },
      { name: QUEUE_TRUCK_IDLE_CHECK },
      { name: QUEUE_OTA_DEPLOY },
      { name: QUEUE_PIN_REGEN },
      { name: QUEUE_MESSAGE_SEND },
    ),
  ],
  providers: [JobSchedulerService],
  exports: [BullModule],
})
export class JobsModule {}
