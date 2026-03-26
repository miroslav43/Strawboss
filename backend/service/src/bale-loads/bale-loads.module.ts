import { Module } from '@nestjs/common';
import { BaleLoadsController } from './bale-loads.controller';
import { BaleLoadsService } from './bale-loads.service';

@Module({
  controllers: [BaleLoadsController],
  providers: [BaleLoadsService],
  exports: [BaleLoadsService],
})
export class BaleLoadsModule {}
