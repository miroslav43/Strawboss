import { Module } from '@nestjs/common';
import { GeofenceService } from './geofence.service';
import { GeofenceProcessor } from './geofence.processor';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [GeofenceService, GeofenceProcessor],
  exports: [GeofenceService],
})
export class GeofenceModule {}
