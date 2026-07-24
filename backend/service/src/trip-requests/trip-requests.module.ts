import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_MESSAGE_SEND, QUEUE_COMANDA_GENERATION } from '../jobs/queues';
import { TripRequestsService } from './trip-requests.service';
import { TripRequestsController } from './trip-requests.controller';
import { PublicPortalController } from './public-portal.controller';
import { BeneficiaryRecordsController } from './beneficiary-records.controller';
import { BeneficiaryRecordsService } from './beneficiary-records.service';
import { BeneficiaryPinVerifier } from './beneficiary-pin.verifier';
import { PinThrottleService } from './pin-throttle.service';
import { PinThrottleGuard } from './pin-throttle.guard';
import { AlertsModule } from '../alerts/alerts.module';
import { TripsModule } from '../trips/trips.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    AlertsModule,
    TripsModule,
    BeneficiariesModule,
    UploadsModule,
    DocumentsModule,
    BullModule.registerQueue({ name: QUEUE_MESSAGE_SEND }, { name: QUEUE_COMANDA_GENERATION }),
  ],
  controllers: [TripRequestsController, PublicPortalController, BeneficiaryRecordsController],
  providers: [
    TripRequestsService,
    BeneficiaryRecordsService,
    BeneficiaryPinVerifier,
    PinThrottleService,
    PinThrottleGuard,
  ],
  exports: [TripRequestsService, BeneficiaryRecordsService],
})
export class TripRequestsModule {}
