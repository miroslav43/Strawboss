import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { HOUR_MS, floorHour } from '@strawboss/domain';
import { MeteoClient } from './meteo-client';
import { MeteoDataService, type OpenCell } from './meteo-data.service';
import { meteoJobsEnabled } from './meteo-access.service';
import {
  PAST_DAYS_MAX,
  PAST_DAYS_MIN,
  METEO_MODELS,
  RAIN_PROB_MODEL,
  RUN_AVAILABILITY_MIN_AGE_MS,
  type HourlyStore,
  type MeteoModelDef,
} from './meteo.constants';
import { QUEUE_METEO_INGEST } from './meteo.queues';

/** Re-fetch for missing history at most this often per (cell, model). */
const BACKFILL_RETRY_MS = 6 * HOUR_MS;

/**
 * Pulls the latest runs from the self-hosted Open-Meteo for every cell that has
 * an open drying clock. Hourly scheduled run covers all cells; a targeted job
 * (`{ eventId }`, queued when a clock is created/backdated) forces a fetch for
 * that event's cell so its history is available right away.
 */
@Injectable()
@Processor(QUEUE_METEO_INGEST)
export class MeteoIngestProcessor extends WorkerHost {
  constructor(
    private readonly client: MeteoClient,
    private readonly data: MeteoDataService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job<{ eventId?: string }>): Promise<void> {
    if (!meteoJobsEnabled() || !this.client.configured) return;
    const forced = Boolean(job.data?.eventId);
    const cells = await this.data.getOpenCells(job.data?.eventId);
    let stored = 0;

    for (const cell of cells) {
      try {
        const pastDays = Math.min(
          PAST_DAYS_MAX,
          Math.max(
            PAST_DAYS_MIN,
            Math.ceil((Date.now() - cell.earliestHarvestMs) / (24 * HOUR_MS)) + 1,
          ),
        );
        for (const model of METEO_MODELS) {
          if (await this.ingestModel(cell, model, pastDays, forced)) stored++;
        }
        if (await this.ingestRainProb(cell, pastDays, forced)) stored++;
      } catch (err) {
        this.winston.error('Meteo ingest failed for cell', {
          context: 'MeteoIngestProcessor',
          coordKey: cell.key,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        });
      }
    }

    // The engine's "now" moves every hour, so every open clock is recomputed on
    // each scheduled tick, whether or not a new model run landed.
    for (const cell of cells) {
      for (const ev of cell.events) await this.data.enqueueEngine(ev.eventId);
    }

    this.winston.log('flow', 'Meteo ingest finished', {
      context: 'MeteoIngestProcessor',
      jobId: job.id,
      forced,
      cells: cells.length,
      storedSeries: stored,
    });
  }

  private async ingestModel(
    cell: OpenCell,
    model: MeteoModelDef,
    pastDays: number,
    forced: boolean,
  ): Promise<boolean> {
    return this.ingest(cell, model, forced, () =>
      this.client.fetchModel(model, cell.lat, cell.lon, pastDays),
    );
  }

  private async ingestRainProb(
    cell: OpenCell,
    pastDays: number,
    forced: boolean,
  ): Promise<boolean> {
    return this.ingest(cell, RAIN_PROB_MODEL, forced, () =>
      this.client.fetchRainProb(cell.lat, cell.lon, pastDays),
    );
  }

  private async ingest(
    cell: OpenCell,
    model: MeteoModelDef,
    forced: boolean,
    fetchStore: () => Promise<HourlyStore | null>,
  ): Promise<boolean> {
    // A run is usable only once it has been "available" for a while.
    const meta = await this.client.fetchRunMeta(model.s3, RUN_AVAILABILITY_MIN_AGE_MS);
    if (!meta) return false;

    const cache = await this.data.getCacheState(cell.key, model.key);
    const newRun = !cache || cache.issuedMs !== meta.initMs;
    const needStartMs = floorHour(cell.earliestHarvestMs) + HOUR_MS;
    const lacksHistory =
      !!cache &&
      (cache.firstMs === null || cache.firstMs > needStartMs) &&
      Date.now() - cache.fetchedMs > BACKFILL_RETRY_MS;
    if (!forced && !newRun && !lacksHistory) return false;

    const store = await fetchStore();
    if (!store) return false;

    // The run may have rolled over while we were downloading — discard the
    // (possibly mixed) result and retry on the next tick.
    const after = await this.client.fetchRunMeta(model.s3);
    if (!after || after.initMs !== meta.initMs) {
      this.winston.warn('Meteo run changed during fetch — discarded', {
        context: 'MeteoIngestProcessor',
        model: model.key,
        coordKey: cell.key,
      });
      return false;
    }

    await this.data.storeIngested(cell, model.key, model.stepH, meta.initMs, store, Date.now());
    return true;
  }
}
