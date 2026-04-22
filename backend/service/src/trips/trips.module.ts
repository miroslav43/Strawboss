import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { QUEUE_CMR_GENERATION } from '../jobs/queues';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_CMR_GENERATION }), NotificationsModule],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
