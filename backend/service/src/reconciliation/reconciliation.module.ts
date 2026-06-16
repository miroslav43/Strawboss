import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationProcessor } from './reconciliation.processor';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [ReconciliationService, ReconciliationProcessor],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
