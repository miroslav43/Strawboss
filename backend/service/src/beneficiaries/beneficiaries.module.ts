import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BeneficiariesService } from './beneficiaries.service';
import { BeneficiariesController } from './beneficiaries.controller';
import { PinRegenProcessor } from './pin-regen.processor';
import { QUEUE_PIN_REGEN } from '../jobs/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_PIN_REGEN })],
  controllers: [BeneficiariesController],
  providers: [BeneficiariesService, PinRegenProcessor],
  exports: [BeneficiariesService],
})
export class BeneficiariesModule {}
