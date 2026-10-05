import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { meteoJobsEnabled } from './meteo-access.service';
import {
  FORECAST_RETENTION_DAYS,
  HISTORY_RETENTION_DAYS,
  SNAPSHOT_RETENTION_DAYS,
} from './meteo.constants';
import { QUEUE_METEO_RETENTION } from './meteo.queues';

const BATCH_SIZE = 2_000;
const MAX_BATCHES = 50;

/** postgres.js exposes the affected-row count as `count` (see gps-retention). */
function affectedRows(result: unknown): number {
  const r = result as { count?: number; rowCount?: number };
  return r.count ?? r.rowCount ?? 0;
}

/** Daily cleanup of the public-data caches and old engine snapshots. */
@Injectable()
@Processor(QUEUE_METEO_RETENTION)
export class MeteoRetentionProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!meteoJobsEnabled()) return;
    // Snapshots a fingerprint points at are kept forever (they are the evidence).
    const snapshots = await this.batched(
      (limit) => sql`
        DELETE FROM meteo_straw_snapshots WHERE id IN (
          SELECT s.id FROM meteo_straw_snapshots s
          WHERE s.computed_at < now() - make_interval(days => ${SNAPSHOT_RETENTION_DAYS})
            AND NOT EXISTS (SELECT 1 FROM meteo_bale_fingerprints f WHERE f.snapshot_id = s.id)
          LIMIT ${limit}
        )`,
    );
    const forecasts = await this.batched(
      (limit) => sql`
        DELETE FROM meteo_forecast_latest WHERE (coord_key, model) IN (
          SELECT coord_key, model FROM meteo_forecast_latest
          WHERE fetched_at < now() - make_interval(days => ${FORECAST_RETENTION_DAYS})
          LIMIT ${limit}
        )`,
    );
    const history = await this.batched(
      (limit) => sql`
        DELETE FROM meteo_cell_history WHERE (coord_key, model, day) IN (
          SELECT coord_key, model, day FROM meteo_cell_history
          WHERE day < current_date - ${HISTORY_RETENTION_DAYS}::int
          LIMIT ${limit}
        )`,
    );
    this.winston.log('flow', 'Meteo retention completed', {
      context: 'MeteoRetentionProcessor',
      jobId: job.id,
      snapshots,
      forecasts,
      history,
    });
  }

  private async batched(stmt: (limit: number) => SQL): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = affectedRows(await this.drizzleProvider.db.execute(stmt(BATCH_SIZE)));
      total += n;
      if (n < BATCH_SIZE) break;
    }
    return total;
  }
}
