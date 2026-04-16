import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { QUEUE_SYNC_CLEANUP } from '../jobs/queues';

@Processor(QUEUE_SYNC_CLEANUP)
export class SyncCleanupProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.winston.info('Sync cleanup: removing stale idempotency records', {
      context: 'SyncCleanupProcessor',
    });

    const result = await this.drizzleProvider.db.execute(sql`
      DELETE FROM sync_idempotency
      WHERE processed_at < NOW() - INTERVAL '30 days'
    `);

    this.winston.info('Sync cleanup completed', {
      context: 'SyncCleanupProcessor',
      deletedRows: (result as unknown as { rowCount?: number }).rowCount ?? 0,
    });
  }
}
