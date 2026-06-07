import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';
import { TripsModule } from '../trips/trips.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  // forwardRef breaks the cycle: TripsModule already imports NotificationsModule
  // (for outbound pushes). The new loader-recall-response endpoint calls
  // TripsService back, so both directions must resolve at runtime.
  // Reconciliation + Alerts power the loader field-exit reconciliation
  // (confirm-parcel-loaded); neither imports NotificationsModule, so no cycle.
  imports: [AuthModule, forwardRef(() => TripsModule), ReconciliationModule, AlertsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
