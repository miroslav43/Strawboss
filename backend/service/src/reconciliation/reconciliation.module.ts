import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationProcessor } from './reconciliation.processor';

@Module({
  providers: [ReconciliationService, ReconciliationProcessor],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
