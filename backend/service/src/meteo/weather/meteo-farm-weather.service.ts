import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import {
  HOUR_MS,
  frostRisk,
  heatStress,
  stormRisk,
  weatherIcon,
  type AgroHour,
} from '@strawboss/domain';
import type { MeteoFarmCell, MeteoFarmParcel, MeteoFarmWeather } from '@strawboss/types';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { MAX_LOCATIONS_PER_REQUEST, type MeteoLane } from '../meteo-client';
import { cellFor, localDate } from './grid';
import { MeteoUpstreamService } from './meteo-upstream.service';
import { MeteoWeatherCacheService, WX_KEY_PREFIX } from './meteo-weather-cache.service';
import { FARM_CELL_SPEC, normaliseFarmCell, type FarmCellPayload } from './weather.specs';

export const FARM_MAX_PARCELS = 1500;
export const FARM_MAX_CELLS = 150;
const FC_FRESH_MS = 55 * 60_000;
const FC_MAX_MS = 6 * 3_600_000;
const POLL_TRIES = 5;
const POLL_MS = 500;

export interface FarmCellRef {
  key: string;
  lat: number;
  lon: number;
  parcelIds: string[];
}

export interface FarmCellWeather {
  cell: MeteoFarmCell;
  hours: AgroHour[];
  fetchedAtMs: number;
  stale: boolean;
}

interface ParcelRow {
  id: string;
  name: string | null;
  code: string | null;
  cropType: string | null;
  harvestStatus: string;
  lat: number;
  lon: number;
  boundary: unknown | null;
  total: number;
}

@Injectable()
export class MeteoFarmWeatherService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly cache: MeteoWeatherCacheService,
    private readonly upstream: MeteoUpstreamService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  /**
   * Parcels with a position, grouped into 0.05° cells. 'active' skips
   * completed parcels (alerts); 'all' is the map. Capped (parcels / cells),
   * the cut is reported in `dropped` and logged — never silent.
   */
  async listActiveCells(
    orgId: string,
    mode: 'all' | 'active',
    opts: { geometry?: boolean } = {},
  ): Promise<{
    cells: FarmCellRef[];
    parcels: MeteoFarmParcel[];
    dropped: { parcels: number; cells: number };
  }> {
    const geometry = opts.geometry !== false;
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT p.id::text AS id, p.name, p.code, p.crop_type::text AS "cropType",
        p.harvest_status::text AS "harvestStatus",
        COALESCE(ST_Y(p.centroid), ST_Y(ST_PointOnSurface(p.boundary)))::float8 AS lat,
        COALESCE(ST_X(p.centroid), ST_X(ST_PointOnSurface(p.boundary)))::float8 AS lon,
        ${
          geometry
            ? sql`CASE WHEN p.boundary IS NULL THEN NULL
                  ELSE ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.boundary, 0.0001), 5)::json END`
            : sql`NULL::json`
        } AS boundary,
        (count(*) OVER ())::int AS total
      FROM parcels p
      WHERE p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
        AND (p.centroid IS NOT NULL OR p.boundary IS NOT NULL)
        ${mode === 'active' ? sql`AND p.harvest_status <> 'completed'` : sql``}
      ORDER BY p.id
      LIMIT ${FARM_MAX_PARCELS}
    `)) as unknown as ParcelRow[];

    const total = rows[0]?.total ?? 0;
    const byCell = new Map<string, FarmCellRef>();
    const cellOf = new Map<string, string>();
    for (const r of rows) {
      const c = cellFor(r.lat, r.lon, 0.05);
      cellOf.set(r.id, c.key);
      const ref = byCell.get(c.key) ?? { key: c.key, lat: c.lat, lon: c.lon, parcelIds: [] };
      ref.parcelIds.push(r.id);
      byCell.set(c.key, ref);
    }
    const ranked = [...byCell.values()].sort(
      (a, b) => b.parcelIds.length - a.parcelIds.length || a.key.localeCompare(b.key),
    );
    const cells = ranked.slice(0, FARM_MAX_CELLS);
    const keep = new Set(cells.map((c) => c.key));
    const parcels: MeteoFarmParcel[] = rows
      .filter((r) => keep.has(cellOf.get(r.id) as string))
      .map((r) => ({
        parcelId: r.id,
        name: r.name,
        code: r.code,
        cropType: r.cropType,
        harvestStatus: r.harvestStatus,
        cellKey: cellOf.get(r.id) as string,
        boundary: r.boundary ?? null,
        lat: r.lat,
        lon: r.lon,
      }));
    const dropped = {
      parcels: Math.max(0, total - parcels.length),
      cells: ranked.length - cells.length,
    };
    if (dropped.parcels > 0 || dropped.cells > 0) {
      this.winston.warn('Meteo farm coverage cut by caps', {
        context: 'MeteoFarmWeatherService',
        orgId,
        mode,
        droppedParcels: dropped.parcels,
        droppedCells: dropped.cells,
      });
    }
    return { cells, parcels, dropped };
  }

  private fcKey(cellKey: string): string {
    return `${WX_KEY_PREFIX}:fc:${cellKey}`;
  }

  /**
   * Per-cell cache (`fc`); missing / stale cells are fetched in ONE
   * multi-coordinate request per chunk of 50 behind a batch lock. Cells whose
   * data is unobtainable are simply absent from the result.
   */
  async getCells(
    cells: readonly { key: string; lat: number; lon: number }[],
    lane: MeteoLane,
  ): Promise<Map<string, FarmCellWeather>> {
    const now = Date.now();
    const payloads = new Map<string, { v: FarmCellPayload; at: number }>();
    const need: typeof cells[number][] = [];
    await Promise.all(
      cells.map(async (c) => {
        const e = await this.cache.read<FarmCellPayload>(this.fcKey(c.key));
        if (e && now - e.fetchedAtMs < FC_MAX_MS) payloads.set(c.key, { v: e.v, at: e.fetchedAtMs });
        if (!e || now - e.fetchedAtMs >= FC_FRESH_MS) need.push(c);
      }),
    );

    for (let i = 0; i < need.length; i += MAX_LOCATIONS_PER_REQUEST) {
      const chunk = need.slice(i, i + MAX_LOCATIONS_PER_REQUEST);
      await this.fetchChunk(chunk, lane, payloads);
    }

    const out = new Map<string, FarmCellWeather>();
    for (const c of cells) {
      const p = payloads.get(c.key);
      if (!p) continue;
      out.set(c.key, {
        cell: this.deriveCell(c, p.v, now),
        hours: p.v.hours,
        fetchedAtMs: p.at,
        stale: now - p.at >= FC_FRESH_MS,
      });
    }
    return out;
  }

  private async fetchChunk(
    chunk: { key: string; lat: number; lon: number }[],
    lane: MeteoLane,
    payloads: Map<string, { v: FarmCellPayload; at: number }>,
  ): Promise<void> {
    const batchKey = `${WX_KEY_PREFIX}:fcb:${createHash('sha1')
      .update(chunk.map((c) => c.key).join('|'))
      .digest('hex')
      .slice(0, 24)}`;
    if (await this.cache.isFailed(batchKey)) return;
    const token = await this.cache.tryLock(batchKey);
    if (!token) {
      // Another replica / request is fetching exactly this chunk: wait for its writes.
      for (let t = 0; t < POLL_TRIES; t++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const reads = await Promise.all(
          chunk.map((c) => this.cache.read<FarmCellPayload>(this.fcKey(c.key))),
        );
        const fresh = reads.every((e) => e && Date.now() - e.fetchedAtMs < FC_FRESH_MS);
        if (fresh) {
          chunk.forEach((c, i) => payloads.set(c.key, { v: reads[i]!.v, at: reads[i]!.fetchedAtMs }));
          return;
        }
      }
      return;
    }
    try {
      const locs = await this.upstream.forecast(FARM_CELL_SPEC, chunk, lane);
      if (!locs) {
        await this.cache.markFailed(batchKey);
        return;
      }
      const at = Date.now();
      await Promise.all(
        chunk.map(async (c, i) => {
          const v = normaliseFarmCell(locs[i]);
          if (!v) return;
          payloads.set(c.key, { v, at });
          await this.cache.write(this.fcKey(c.key), v, FC_MAX_MS, at);
        }),
      );
    } finally {
      await this.cache.unlock(batchKey, token);
    }
  }

  private deriveCell(
    c: { key: string; lat: number; lon: number },
    p: FarmCellPayload,
    now: number,
  ): MeteoFarmCell {
    const from = Math.floor(now / HOUR_MS) * HOUR_MS;
    const h24 = p.hours.filter((h) => h.timeMs >= from && h.timeMs < from + 24 * HOUR_MS);
    const h48 = p.hours.filter((h) => h.timeMs >= from && h.timeMs < from + 48 * HOUR_MS);
    const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
    const sum = (xs: number[]): number | null =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    const max = (xs: number[]): number | null => (xs.length ? Math.max(...xs) : null);
    const min = (xs: number[]): number | null => (xs.length ? Math.min(...xs) : null);

    // Heat from the per-local-day maximum of the 48 h of temperatures.
    const dayMax = new Map<string, number>();
    for (const h of h48) {
      if (h.tempC === null) continue;
      const d = localDate(h.timeMs);
      dayMax.set(d, Math.max(dayMax.get(d) ?? -Infinity, h.tempC));
    }
    const heat = heatStress([...dayMax].map(([date, tMaxC]) => ({ date, tMaxC })));

    return {
      key: c.key,
      lat: c.lat,
      lon: c.lon,
      icon: weatherIcon(p.currentCode, p.currentIsDay),
      isDay: p.currentIsDay,
      tempNowC: p.currentTempC,
      rain24hMm: h24.length ? sum(nums(h24.map((h) => h.precipMm))) : null,
      rainProbMax24h: max(nums(h24.map((h) => h.precipProb))),
      gustMax24hMs: max(nums(h24.map((h) => h.gustMs))),
      tMin48hC: min(nums(h48.map((h) => h.tempC))),
      soilMin48hC: min(nums(h48.map((h) => h.soilTemp0C))),
      frost: frostRisk(p.hours, now).level,
      storm: stormRisk(p.hours, now).level,
      heat: heat.level,
    };
  }

  async getFarmWeather(orgId: string): Promise<MeteoFarmWeather> {
    const { cells, parcels, dropped } = await this.listActiveCells(orgId, 'all');
    const wx = await this.getCells(cells, 'interactive');
    const values = [...wx.values()];
    return {
      fetchedAt: values.length ? new Date(Math.min(...values.map((v) => v.fetchedAtMs))).toISOString() : null,
      stale: values.some((v) => v.stale),
      cells: values.map((v) => v.cell),
      parcels,
      dropped,
    };
  }
}
