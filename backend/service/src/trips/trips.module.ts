import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TruckIdleProcessor } from './truck-idle.processor';
import { TripAutocompleteProcessor } from './trip-autocomplete.processor';
import { StalePlanSweepProcessor } from './stale-plan-sweep.processor';
import {
  QUEUE_CMR_GENERATION,
  QUEUE_TRUCK_IDLE_CHECK,
  QUEUE_TRIP_AUTOCOMPLETE,
  QUEUE_STALE_PLAN_SWEEP,
} from '../jobs/queues';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryDestinationsModule } from '../delivery-destinations/delivery-destinations.module';
import { AlertsModule } from '../alerts/alerts.module';
import { ParcelsModule } from '../parcels/parcels.module';
import { CmrScansModule } from '../cmr-scans/cmr-scans.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_CMR_GENERATION },
      { name: QUEUE_TRUCK_IDLE_CHECK },
      { name: QUEUE_TRIP_AUTOCOMPLETE },
      { name: QUEUE_STALE_PLAN_SWEEP },
    ),
    forwardRef(() => NotificationsModule),
    DeliveryDestinationsModule,
    AlertsModule,
    ParcelsModule,
    CmrScansModule,
  ],
  controllers: [TripsController],
  providers: [TripsService, TruckIdleProcessor, TripAutocompleteProcessor, StalePlanSweepProcessor],
  exports: [TripsService],
})
export class TripsModule {}
