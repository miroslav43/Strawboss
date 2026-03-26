import { Module } from '@nestjs/common';
import { ConsumableLogsController } from './consumable-logs.controller';
import { ConsumableLogsService } from './consumable-logs.service';

@Module({
  controllers: [ConsumableLogsController],
  providers: [ConsumableLogsService],
  exports: [ConsumableLogsService],
})
export class ConsumableLogsModule {}
