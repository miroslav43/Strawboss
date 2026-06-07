import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_GEOFENCE_CHECK } from '../jobs/queues';

@Module({
  // Register the geofence queue here so a fresh GPS report can enqueue an
  // immediate (throttled) geofence check — event-driven detection (audit #4).
  imports: [DatabaseModule, AuthModule, BullModule.registerQueue({ name: QUEUE_GEOFENCE_CHECK })],
  controllers: [LocationController],
  providers: [LocationService],
})
export class LocationModule {}
