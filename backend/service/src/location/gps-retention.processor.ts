import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { QUEUE_GPS_RETENTION } from '../jobs/queues';

/** Rows deleted per DELETE statement — bounds lock/transaction size. */
const BATCH_SIZE = 20_000;

/**
 * Affected-row count from a raw db.execute() DELETE. The postgres.js driver
 * (drizzle-orm/postgres-js) exposes it as `count` — `rowCount` is the
 * node-postgres name and is undefined here; reading the wrong one would make
 * every batch look empty and stop the loop after one batch.
 */
function affectedRows(result: unknown): number {
  const r = result as { count?: number; rowCount?: number };
  return r.count ?? r.rowCount ?? 0;
}
/**
 * Safety cap on batches per step per run. The first few runs after this job
 * ships may have a large backlog (months of unretained history); the cap
 * lets a run finish in bounded time and simply picks up where it left off on
 * the next night's run instead of running unbounded.
 */
const MAX_BATCHES_PER_STEP = 50;

/**
 * GPS retention/downsampling for `machine_location_events` (user decision D1):
 *   - 0–14 days:  full resolution, untouched.
 *   - 14–90 days: downsampled to 1 point per machine per minute.
 *   - >90 days:   deleted entirely.
 *
 * Runs daily at 02:30 (see JobSchedulerService). Both steps run in batched
 * DELETE loops so a large backlog can't hold one long transaction/lock.
 */
@Processor(QUEUE_GPS_RETENTION)
export class GpsRetentionProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.winston.info('GPS retention: starting cleanup of machine_location_events', {
      context: 'GpsRetentionProcessor',
    });

    const purged = await this.purgeOlderThan90Days();
    const downsampled = await this.downsample14To90Days();

    this.winston.log('flow', 'GPS retention completed', {
      context: 'GpsRetentionProcessor',
      purgedRows: purged.deleted,
      purgeCapHit: purged.capHit,
      downsampledRows: downsampled.deleted,
      downsampleCapHit: downsampled.capHit,
    });
  }

  /**
   * Step A: permanently delete any row older than 90 days, regardless of
   * resolution. Batched + capped — see MAX_BATCHES_PER_STEP.
   */
  private async purgeOlderThan90Days(): Promise<{ deleted: number; capHit: boolean }> {
    let deleted = 0;
    let capHit = false;

    for (let i = 0; i < MAX_BATCHES_PER_STEP; i++) {
      const result = await this.drizzleProvider.db.execute(sql`
        DELETE FROM machine_location_events
        WHERE id IN (
          SELECT id FROM machine_location_events
          WHERE recorded_at < NOW() - INTERVAL '90 days'
          LIMIT ${BATCH_SIZE}
        )
      `);
      const rowCount = affectedRows(result);
      deleted += rowCount;
      if (rowCount < BATCH_SIZE) break;
      if (i === MAX_BATCHES_PER_STEP - 1) capHit = true;
    }

    return { deleted, capHit };
  }

  /**
   * Step B: downsample the 14–90 day window to 1 point per machine per
   * minute. Keeper = first row (by recorded_at ASC) in each
   * (machine_id, minute) bucket; every other row in the bucket is deleted.
   *
   * Rows with machine_id IS NULL (an operator with no assigned machine at
   * ping time — see the "truck task has no assigned user" fallback in
   * reportLocation) would otherwise escape this downsample entirely since
   * they can't be partitioned by machine. They're downsampled the same way,
   * keyed by operator_id instead — simpler than trying to backfill machine
   * attribution retroactively, and keeps their volume bounded too.
   */
  private async downsample14To90Days(): Promise<{ deleted: number; capHit: boolean }> {
    let deleted = 0;
    let capHit = false;

    for (let i = 0; i < MAX_BATCHES_PER_STEP; i++) {
      const result = await this.drizzleProvider.db.execute(sql`
        DELETE FROM machine_location_events WHERE id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (
              PARTITION BY machine_id, date_trunc('minute', recorded_at)
              ORDER BY recorded_at ASC
            ) AS rn
            FROM machine_location_events
            WHERE recorded_at < NOW() - INTERVAL '14 days'
              AND recorded_at >= NOW() - INTERVAL '90 days'
              AND machine_id IS NOT NULL
          ) t WHERE t.rn > 1
          LIMIT ${BATCH_SIZE}
        )
      `);
      const rowCount = affectedRows(result);
      deleted += rowCount;
      if (rowCount < BATCH_SIZE) break;
      if (i === MAX_BATCHES_PER_STEP - 1) capHit = true;
    }

    // machine_id IS NULL rows: same downsample, keyed by operator_id.
    for (let i = 0; i < MAX_BATCHES_PER_STEP; i++) {
      const result = await this.drizzleProvider.db.execute(sql`
        DELETE FROM machine_location_events WHERE id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (
              PARTITION BY operator_id, date_trunc('minute', recorded_at)
              ORDER BY recorded_at ASC
            ) AS rn
            FROM machine_location_events
            WHERE recorded_at < NOW() - INTERVAL '14 days'
              AND recorded_at >= NOW() - INTERVAL '90 days'
              AND machine_id IS NULL
          ) t WHERE t.rn > 1
          LIMIT ${BATCH_SIZE}
        )
      `);
      const rowCount = affectedRows(result);
      deleted += rowCount;
      if (rowCount < BATCH_SIZE) break;
      if (i === MAX_BATCHES_PER_STEP - 1) capHit = true;
    }

    return { deleted, capHit };
  }
}
