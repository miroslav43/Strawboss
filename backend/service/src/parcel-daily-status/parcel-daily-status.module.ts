import { Module } from '@nestjs/common';
import { ParcelsModule } from '../parcels/parcels.module';
import { ParcelDailyStatusController } from './parcel-daily-status.controller';
import { ParcelDailyStatusService } from './parcel-daily-status.service';

@Module({
  imports: [ParcelsModule],
  controllers: [ParcelDailyStatusController],
  providers: [ParcelDailyStatusService],
  exports: [ParcelDailyStatusService],
})
export class ParcelDailyStatusModule {}
