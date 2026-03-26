import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_ALERT_EVALUATION,
  QUEUE_RECONCILIATION,
  QUEUE_CMR_GENERATION,
  QUEUE_FARMTRACK_SYNC,
  QUEUE_SYNC_CLEANUP,
} from './queues';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: 'localhost', port: 6379 },
    }),
    BullModule.registerQueue(
      { name: QUEUE_ALERT_EVALUATION },
      { name: QUEUE_RECONCILIATION },
      { name: QUEUE_CMR_GENERATION },
      { name: QUEUE_FARMTRACK_SYNC },
      { name: QUEUE_SYNC_CLEANUP },
    ),
  ],
  exports: [BullModule],
})
export class JobsModule {}
