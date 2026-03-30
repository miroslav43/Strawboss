import { Module } from '@nestjs/common';
import { BaleProductionsController } from './bale-productions.controller';
import { BaleProductionsService } from './bale-productions.service';

@Module({
  controllers: [BaleProductionsController],
  providers: [BaleProductionsService],
  exports: [BaleProductionsService],
})
export class BaleProductionsModule {}
