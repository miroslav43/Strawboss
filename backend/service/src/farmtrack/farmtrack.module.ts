import { Module } from '@nestjs/common';
import {
  StubFarmTrackService,
  FARMTRACK_SERVICE,
} from './farmtrack.service';
import { FarmTrackWebhookController } from './farmtrack.webhook';

@Module({
  controllers: [FarmTrackWebhookController],
  providers: [
    {
      provide: FARMTRACK_SERVICE,
      useClass: StubFarmTrackService,
    },
  ],
  exports: [FARMTRACK_SERVICE],
})
export class FarmTrackModule {}
