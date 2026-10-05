import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { doyIndex, gddBaseFor, gddDay, climateAnomaly } from '@strawboss/domain';
import { isFeatureEnabled, type MeteoParcelClimate } from '@strawboss/types';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { FeatureDisabledException } from '../../features/feature-disabled.exception';
import { MeteoAccessService, meteoJobsEnabled } from '../meteo-access.service';
import { MeteoClient } from '../meteo-client';
import { asJson } from '../meteo-data.service';
import { QUEUE_METEO_CLIMATE } from '../meteo.queues';
import { cellFor, localDate } from '../weather/grid';

const DAY_MS = 86_400_000;
const SOURCE_NOTE = 'ERA5 1991–2020 (Open-Meteo)';

interface NormalsRow {
  status: string;
  period: string;
  doyTmean: number[] | null;
  doyPrecip: number[] | null;
  doyGdd0: number[] | null;
  doyGdd5: number[] | null;
  monthly: { month: number; tmeanC: number; precipMm: number }[] | null;
}

interface DailyRow {
  day: string;
  tmeanC: number | null;
  precipMm: number | null;
}

export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

@Injectable()
export class MeteoClimateService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    private readonly client: MeteoClient,
    @InjectQueue(QUEUE_METEO_CLIMATE) private readonly queue: Queue,
  ) {}

  async getParcelClimate(
    orgId: string,
    parcelId: string,
    disabledFeatures: readonly string[],
  ): Promise<MeteoParcelClimate> {
    const empty = (status: MeteoParcelClimate['status'], cellKey: string | null): MeteoParcelClimate => ({
      status,
      cellKey,
      period: '1991-2020',
      monthlyNormals: [],
      monthToDate: null,
      last30: null,
      gdd: null,
      sourceNote: SOURCE_NOTE,
    });
    if (!this.client.archiveConfigured) return empty('not_configured', null);
    if (
      !isFeatureEnabled(disabledFeatures, 'meteo') ||
      !isFeatureEnabled(disabledFeatures, 'meteo.climate') ||
      !(await this.access.isOptedIn(orgId))
    ) {
      throw new FeatureDisabledException('meteo.climate');
    }

    const parcels = (await this.drizzleProvider.db.execute(sql`
      SELECT p.crop_type::text AS "cropType",
        COALESCE(ST_Y(p.centroid), ST_Y(ST_PointOnSurface(p.boundary)))::float8 AS lat,
        COALESCE(ST_X(p.centroid), ST_X(ST_PointOnSurface(p.boundary)))::float8 AS lon
      FROM parcels p
      WHERE p.id = ${parcelId}::uuid AND p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as { cropType: string | null; lat: number | null; lon: number | null }[];
    const parcel = parcels[0];
    if (!parcel) throw new NotFoundException('Parcel not found');
    if (parcel.lat === null || parcel.lon === null) return empty('no_location', null);

    const cell = cellFor(parcel.lat, parcel.lon, 0.25);
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT status, period, doy_tmean AS "doyTmean", doy_precip AS "doyPrecip",
        doy_gdd0 AS "doyGdd0", doy_gdd5 AS "doyGdd5", monthly
      FROM meteo_climate_normals WHERE cell_key = ${cell.key} LIMIT 1
    `)) as unknown as NormalsRow[];
    const n = rows[0];

    if (!n || n.status !== 'ready' || !n.doyTmean || !n.doyPrecip || !n.doyGdd0 || !n.doyGdd5) {
      await this.requestNormals(cell);
      return empty('pending', cell.key);
    }
    // Keep the cell "recently requested" while people look at it: the daily job
    // only refreshes actuals for cells requested in the last 45 days. Throttled
    // to one write per cell per day; failure is harmless.
    await this.drizzleProvider.db
      .execute(sql`
        UPDATE meteo_climate_normals SET requested_at = now()
        WHERE cell_key = ${cell.key} AND requested_at < now() - interval '1 day'
      `)
      .catch(() => undefined);
    const doyTmean = asJson<number[]>(n.doyTmean);
    const doyPrecip = asJson<number[]>(n.doyPrecip);
    const doyGdd = asJson<number[]>(gddBaseFor(parcel.cropType) === 0 ? n.doyGdd0 : n.doyGdd5);

    const today = localDate(Date.now());
    const yesterday = addDays(today, -1);
    const year = today.slice(0, 4);
    const monthStart = `${today.slice(0, 7)}-01`;
    const baseStart = addDays(today, -31) < `${year}-01-01` ? addDays(today, -31) : `${year}-01-01`;
    const daily = (await this.drizzleProvider.db.execute(sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, tmean_c::float8 AS "tmeanC", precip_mm::float8 AS "precipMm"
      FROM meteo_climate_daily
      WHERE cell_key = ${cell.key} AND day >= ${baseStart}::date AND day <= ${yesterday}::date
      ORDER BY day
      LIMIT 800
    `)) as unknown as DailyRow[];

    /** Actual vs normal over the days that actually have data (apples to apples). */
    const stats = (from: string, to: string) => {
      const rs = daily.filter((d) => d.day >= from && d.day <= to);
      const t = rs.filter((d) => d.tmeanC !== null);
      const p = rs.filter((d) => d.precipMm !== null);
      const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      return {
        days: t.length,
        tmean: mean(t.map((d) => d.tmeanC as number)),
        normalTmean: mean(t.map((d) => doyTmean[doyIndex(d.day)] ?? 0)),
        precip: p.length ? p.reduce((a, d) => a + (d.precipMm as number), 0) : null,
        normalPrecip: p.length ? p.reduce((a, d) => a + (doyPrecip[doyIndex(d.day)] ?? 0), 0) : null,
      };
    };

    const m = stats(monthStart, yesterday);
    const monthEnd = new Date(Date.UTC(Number(year), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
    let fullMonth = 0;
    for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) fullMonth += doyPrecip[doyIndex(d)] ?? 0;
    const monthToDate: MeteoParcelClimate['monthToDate'] =
      m.days === 0
        ? null
        : {
            month: Number(today.slice(5, 7)),
            days: m.days,
            tmeanC: m.tmean === null ? null : r1(m.tmean),
            normalTmeanC: m.normalTmean === null ? null : r1(m.normalTmean),
            precipMm: m.precip === null ? null : r1(m.precip),
            normalPrecipMm: m.normalPrecip === null ? null : r1(m.normalPrecip),
            fullMonthNormalPrecipMm: r1(fullMonth),
          };

    const from30 = addDays(today, -30);
    const l = stats(from30, yesterday);
    const an = climateAnomaly({
      actualTmean: l.tmean,
      normalTmean: l.normalTmean,
      actualPrecip: l.precip,
      normalPrecip: l.normalPrecip,
    });
    const last30: MeteoParcelClimate['last30'] =
      l.days === 0
        ? null
        : {
            from: from30,
            to: yesterday,
            tmeanC: l.tmean === null ? null : r1(l.tmean),
            normalTmeanC: l.normalTmean === null ? null : r1(l.normalTmean),
            anomalyC: an.anomalyC,
            precipMm: l.precip === null ? null : r1(l.precip),
            normalPrecipMm: l.normalPrecip === null ? null : r1(l.normalPrecip),
            precipPct: an.precipPct,
            daysCovered: l.days,
          };

    const baseC = gddBaseFor(parcel.cropType);
    const yStart = `${year}-01-01`;
    const gddDays = daily.filter((d) => d.day >= yStart && d.tmeanC !== null);
    let gdd: MeteoParcelClimate['gdd'] = null;
    if (gddDays.length > 0) {
      const value = gddDays.reduce((a, d) => a + gddDay(d.tmeanC as number, baseC), 0);
      const normal = gddDays.reduce((a, d) => a + (doyGdd[doyIndex(d.day)] ?? 0), 0);
      gdd = {
        cropType: parcel.cropType,
        baseC,
        start: yStart,
        to: gddDays[gddDays.length - 1].day,
        basis: 'calendar_year',
        value: r1(value),
        normal: r1(normal),
        anomalyPct: normal > 0 ? Math.round(((value - normal) / normal) * 100) : null,
        daysCovered: gddDays.length,
      };
    }

    return {
      status: 'ready',
      cellKey: cell.key,
      period: n.period,
      monthlyNormals: n.monthly ? asJson<NonNullable<NormalsRow['monthly']>>(n.monthly).map((x) => ({
        month: x.month,
        tmeanC: r2(x.tmeanC),
        precipMm: r1(x.precipMm),
      })) : [],
      monthToDate,
      last30,
      gdd,
      sourceNote: SOURCE_NOTE,
    };
  }

  /** Cheap and idempotent: (re)queue the normals fill, never do work on the request path. */
  private async requestNormals(cell: { key: string; lat: number; lon: number }): Promise<void> {
    const res = await this.drizzleProvider.db.execute(sql`
      INSERT INTO meteo_climate_normals (cell_key, lat, lon, status)
      VALUES (${cell.key}, ${cell.lat}, ${cell.lon}, 'pending')
      ON CONFLICT (cell_key) DO UPDATE SET
        requested_at = now(),
        status = CASE WHEN meteo_climate_normals.status = 'failed' THEN 'pending' ELSE meteo_climate_normals.status END,
        attempts = CASE WHEN meteo_climate_normals.status = 'failed' THEN 0 ELSE meteo_climate_normals.attempts END
      WHERE meteo_climate_normals.status <> 'ready'
        AND meteo_climate_normals.requested_at < now() - interval '1 day'
    `);
    const r = res as unknown as { count?: number; rowCount?: number };
    if ((r.count ?? r.rowCount ?? 0) > 0 && meteoJobsEnabled()) {
      await this.queue
        .add(
          'normals',
          { cellKey: cell.key },
          // removeOnFail: true — a kept failed job would block every later add with
          // the same fixed jobId (BullMQ ignores duplicate ids in any state).
          { jobId: `meteo-climate-${cell.key}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
        )
        .catch(() => undefined);
    }
  }
}
