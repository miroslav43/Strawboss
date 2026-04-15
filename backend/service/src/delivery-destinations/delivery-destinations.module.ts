import { Module } from '@nestjs/common';
import { DeliveryDestinationsController } from './delivery-destinations.controller';
import { DeliveryDestinationsService } from './delivery-destinations.service';

@Module({
  controllers: [DeliveryDestinationsController],
  providers: [DeliveryDestinationsService],
  exports: [DeliveryDestinationsService],
})
export class DeliveryDestinationsModule {}
