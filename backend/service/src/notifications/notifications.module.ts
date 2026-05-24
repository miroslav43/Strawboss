import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';
import { TripsModule } from '../trips/trips.module';

@Module({
  // forwardRef breaks the cycle: TripsModule already imports NotificationsModule
  // (for outbound pushes). The new loader-recall-response endpoint calls
  // TripsService back, so both directions must resolve at runtime.
  imports: [AuthModule, forwardRef(() => TripsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
