import { Module } from '@nestjs/common';
import { DepositInventoryController } from './deposit-inventory.controller';
import { DepositInventoryService } from './deposit-inventory.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DepositInventoryController],
  providers: [DepositInventoryService],
  exports: [DepositInventoryService],
})
export class DepositInventoryModule {}
