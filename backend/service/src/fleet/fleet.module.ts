import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FleetController } from './fleet.controller';
import { FleetAdminController } from './fleet-admin.controller';
import { FleetService } from './fleet.service';
import { FleetPushService } from './fleet-push.service';
import { OtaDeployProcessor } from './ota-deploy.processor';
import { PresenceDeadmanProcessor } from './presence-deadman.processor';
import { QUEUE_OTA_DEPLOY, QUEUE_PRESENCE_DEADMAN } from '../jobs/queues';

@Module({
  imports: [
    // Register the queues here so their processors run in this module's DI scope.
    // JobsModule already registers them globally via BullModule.registerQueue (which
    // is inherited via exports: [BullModule]), but we need the typed Queue token
    // to be available in this module's DI scope too.
    BullModule.registerQueue({ name: QUEUE_OTA_DEPLOY }, { name: QUEUE_PRESENCE_DEADMAN }),
  ],
  controllers: [FleetController, FleetAdminController],
  providers: [FleetService, FleetPushService, OtaDeployProcessor, PresenceDeadmanProcessor],
  exports: [FleetService],
})
export class FleetModule {}
