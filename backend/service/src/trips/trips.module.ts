import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TruckIdleProcessor } from './truck-idle.processor';
import { QUEUE_CMR_GENERATION, QUEUE_TRUCK_IDLE_CHECK } from '../jobs/queues';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryDestinationsModule } from '../delivery-destinations/delivery-destinations.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_CMR_GENERATION }, { name: QUEUE_TRUCK_IDLE_CHECK }),
    forwardRef(() => NotificationsModule),
    DeliveryDestinationsModule,
    AlertsModule,
  ],
  controllers: [TripsController],
  providers: [TripsService, TruckIdleProcessor],
  exports: [TripsService],
})
export class TripsModule {}
