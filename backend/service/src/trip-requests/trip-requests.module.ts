import { Module } from '@nestjs/common';
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

@Module({
  imports: [AlertsModule, TripsModule, BeneficiariesModule],
  controllers: [TripRequestsController, PublicPortalController, BeneficiaryRecordsController],
  providers: [
    TripRequestsService,
    BeneficiaryRecordsService,
    BeneficiaryPinVerifier,
    PinThrottleService,
    PinThrottleGuard,
  ],
  exports: [TripRequestsService],
})
export class TripRequestsModule {}
