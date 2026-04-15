import { Module } from '@nestjs/common';
import { MobileLogsController } from './mobile-logs.controller';
import { MobileLogsService } from './mobile-logs.service';

@Module({
  controllers: [MobileLogsController],
  providers: [MobileLogsService],
})
export class MobileLogsModule {}
