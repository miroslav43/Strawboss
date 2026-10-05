import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { buildClimateNormals } from '@strawboss/domain';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { MeteoAccessService, meteoJobsEnabled } from '../meteo-access.service';
import { MeteoClient } from '../meteo-client';
import { QUEUE_METEO_CLIMATE } from '../meteo.queues';
import { localDate } from '../weather/grid';
import { MeteoUpstreamService } from '../weather/meteo-upstream.service';
import { CLIMATE_DAILY_SPEC, CLIMATE_NORMALS_SPEC, normaliseClimateDaily } from '../weather/weather.specs';
import { addDays } from './meteo-climate.service';

const MAX_NORMALS_PER_RUN = 2;
const MAX_ATTEMPTS = 5;
const MAX_DAILY_CELLS = 50;
/** A normals fetch must cover (nearly) all of 1991–2020, i.e. ~10958 days. */
const MIN_NORMALS_DAYS = 9_000;

interface CellRow {
  cellKey: string;
  lat: number;
  lon: number;
  attempts: number;
}

/**
 * Daily 04:30 + targeted `normals` jobs. Fills the 1991–2020 ERA5 normals of
 * the cells parcels asked for (≤2 per daily run) and tops up the current-year
 * daily actuals of recently requested cells. Only when some opted-in org has
 * meteo.climate on; every upstream call is budget-checked.
 */
@Injectable()
@Processor(QUEUE_METEO_CLIMATE)
export class MeteoClimateProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    private readonly client: MeteoClient,
    private readonly upstream: MeteoUpstreamService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!meteoJobsEnabled() || !this.client.archiveConfigured) return;
    if (!(await this.anyOrgActive())) return;

    const targeted = job.name === 'normals' ? (job.data as { cellKey?: string }).cellKey : undefined;
    const pending = await this.pendingNormals(targeted);
    let filled = 0;
    for (const cell of pending) {
      if (await this.fillNormals(cell)) filled++;
    }
    let dailyCells = 0;
    if (!targeted) dailyCells = await this.refreshDaily();
    this.winston.log('flow', 'Meteo climate job completed', {
      context: 'MeteoClimateProcessor',
      jobId: job.id,
      pending: pending.length,
      filled,
      dailyCells,
    });
  }

  private async anyOrgActive(): Promise<boolean> {
    for (const orgId of await this.access.listOptedInOrgIds()) {
      try {
        if (await this.access.isActiveForOrg(orgId, 'meteo.climate')) return true;
      } catch {
        // per-org failure must not block the others
      }
    }
    return false;
  }

  private async pendingNormals(cellKey?: string): Promise<CellRow[]> {
    return (await this.drizzleProvider.db.execute(sql`
      SELECT cell_key AS "cellKey", lat::float8 AS lat, lon::float8 AS lon, attempts
      FROM meteo_climate_normals
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS}
        ${cellKey ? sql`AND cell_key = ${cellKey}` : sql``}
      ORDER BY requested_at
      LIMIT ${cellKey ? 1 : MAX_NORMALS_PER_RUN}
    `)) as unknown as CellRow[];
  }

  private async fillNormals(cell: CellRow): Promise<boolean> {
    const raw = await this.upstream.archive({ lat: cell.lat, lon: cell.lon, ...CLIMATE_NORMALS_SPEC }, 'background');
    const days = normaliseClimateDaily(raw);
    if (days.length < MIN_NORMALS_DAYS) {
      await this.drizzleProvider.db.execute(sql`
        UPDATE meteo_climate_normals SET
          attempts = attempts + 1,
          last_error = ${raw ? `short series (${days.length} days)` : 'archive fetch failed'},
          status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE status END
        WHERE cell_key = ${cell.cellKey}
      `);
      return false;
    }
    const n = buildClimateNormals(days.map((d) => ({ date: d.date, tmeanC: d.tmeanC, precipMm: d.precipMm })));
    const j = (v: unknown): string => JSON.stringify(v);
    await this.drizzleProvider.db.execute(sql`
      UPDATE meteo_climate_normals SET
        status = 'ready', last_error = NULL, fetched_at = now(),
        source_host = ${this.client.publicApi ? 'public' : 'self'}, model = NULL,
        years = ${n.years},
        doy_tmean = ${j(n.doyTmean)}::jsonb, doy_precip = ${j(n.doyPrecip)}::jsonb,
        doy_gdd0 = ${j(n.doyGdd0)}::jsonb, doy_gdd5 = ${j(n.doyGdd5)}::jsonb,
        monthly = ${j(n.monthly)}::jsonb
      WHERE cell_key = ${cell.cellKey}
    `);
    this.winston.log('flow', 'Meteo climate normals ready', {
      context: 'MeteoClimateProcessor',
      cellKey: cell.cellKey,
      years: n.years,
    });
    return true;
  }

  /** Current-year daily actuals for cells requested in the last 45 days. */
  private async refreshDaily(): Promise<number> {
    const cells = (await this.drizzleProvider.db.execute(sql`
      SELECT n.cell_key AS "cellKey", n.lat::float8 AS lat, n.lon::float8 AS lon, 0 AS attempts,
        (SELECT to_char(max(d.day), 'YYYY-MM-DD') FROM meteo_climate_daily d WHERE d.cell_key = n.cell_key) AS "lastDay"
      FROM meteo_climate_normals n
      WHERE n.status = 'ready' AND n.requested_at > now() - interval '45 days'
      ORDER BY n.requested_at DESC
      LIMIT ${MAX_DAILY_CELLS}
    `)) as unknown as (CellRow & { lastDay: string | null })[];

    const today = localDate(Date.now());
    const yesterday = addDays(today, -1);
    const jan1 = `${today.slice(0, 4)}-01-01`;
    // In January the last-30-days window reaches into the previous year.
    const baseStart = addDays(today, -31) < jan1 ? addDays(today, -31) : jan1;
    let done = 0;
    for (const c of cells) {
      const startDate = c.lastDay && addDays(c.lastDay, -7) > baseStart ? addDays(c.lastDay, -7) : baseStart;
      if (startDate > yesterday) continue;
      const raw = await this.upstream.archive(
        { lat: c.lat, lon: c.lon, startDate, endDate: yesterday, ...CLIMATE_DAILY_SPEC },
        'background',
      );
      const rows = normaliseClimateDaily(raw).filter((d) => d.tmeanC !== null || d.precipMm !== null);
      if (rows.length === 0) continue;
      const host = this.client.publicApi ? 'public' : 'self';
      const values = rows.map(
        (d) => sql`(${c.cellKey}, ${d.date}::date, ${d.tmeanC}, ${d.precipMm}, ${host}, now())`,
      );
      await this.drizzleProvider.db.execute(sql`
        INSERT INTO meteo_climate_daily (cell_key, day, tmean_c, precip_mm, source_host, fetched_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (cell_key, day) DO UPDATE SET
          tmean_c = EXCLUDED.tmean_c, precip_mm = EXCLUDED.precip_mm,
          source_host = EXCLUDED.source_host, fetched_at = now()
      `);
      done++;
    }
    return done;
  }
}
