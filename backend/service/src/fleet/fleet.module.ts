import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FleetController } from './fleet.controller';
import { FleetAdminController } from './fleet-admin.controller';
import { FleetService } from './fleet.service';
import { FleetPushService } from './fleet-push.service';
import { OtaDeployProcessor } from './ota-deploy.processor';
import { ProfileModule } from '../profile/profile.module';
import { QUEUE_OTA_DEPLOY } from '../jobs/queues';

@Module({
  imports: [
    // Register the queue here so FleetService can @InjectQueue it.
    // JobsModule already registers it globally via BullModule.registerQueue (which
    // is inherited via exports: [BullModule]), but we need the typed Queue token
    // to be available in this module's DI scope too.
    BullModule.registerQueue({ name: QUEUE_OTA_DEPLOY }),
    // ProfileModule gives us ProfileService.touchLastSeen so a public check-in
    // (native 60s alarm) keeps the operator's presence fresh — the stable signal.
    ProfileModule,
  ],
  controllers: [FleetController, FleetAdminController],
  providers: [FleetService, FleetPushService, OtaDeployProcessor],
  exports: [FleetService],
})
export class FleetModule {}
