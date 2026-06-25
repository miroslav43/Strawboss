import { Module } from '@nestjs/common';
import { TripRequestsService } from './trip-requests.service';
import { TripRequestsController } from './trip-requests.controller';
import { PublicPortalController } from './public-portal.controller';
import { AlertsModule } from '../alerts/alerts.module';
import { TripsModule } from '../trips/trips.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';

@Module({
  imports: [AlertsModule, TripsModule, BeneficiariesModule],
  controllers: [TripRequestsController, PublicPortalController],
  providers: [TripRequestsService],
  exports: [TripRequestsService],
})
export class TripRequestsModule {}
