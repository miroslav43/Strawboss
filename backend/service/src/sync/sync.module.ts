import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncCleanupProcessor } from './sync-cleanup.processor';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncCleanupProcessor],
  exports: [SyncService],
})
export class SyncModule {}
