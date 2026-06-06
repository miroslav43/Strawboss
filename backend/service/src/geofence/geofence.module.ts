import { Module } from '@nestjs/common';
import { GeofenceService } from './geofence.service';
import { GeofenceProcessor } from './geofence.processor';
import { GeofenceController } from './geofence.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [GeofenceController],
  providers: [GeofenceService, GeofenceProcessor],
  exports: [GeofenceService],
})
export class GeofenceModule {}
