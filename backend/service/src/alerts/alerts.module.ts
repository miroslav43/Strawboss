import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsProcessor } from './alerts.processor';

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertsProcessor],
  exports: [AlertsService],
})
export class AlertsModule {}
