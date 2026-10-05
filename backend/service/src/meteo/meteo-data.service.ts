import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql, type SQL } from 'drizzle-orm';
import {
  HOUR_MS,
  STRAW_PARAMS_V1,
  markBaleableHours,
  requiredHoursFor,
  runStrawEngine,
  type EngineReading,
  type WeatherHour,
  type WeatherSeries,
} from '@strawboss/domain';
import type { MeteoHourPoint, MeteoReason, SwathType } from '@strawboss/types';
import { DrizzleProvider } from '../database/drizzle.provider';
import { MeteoAccessService, meteoJobsEnabled } from './meteo-access.service';
import {
  FALLBACK_MODEL_KEY,
  MAX_MISSING_PAST_SHARE,
  METEO_MODEL_VERSION,
  PRIMARY_MODEL_KEY,
  RAIN_PROB_MODEL,
  roundCoord,
  type HourlyStore,
  type RoundedCoord,
} from './meteo.constants';
import { METEO_ENQUEUE_DEBOUNCE_MS, QUEUE_METEO_ENGINE, QUEUE_METEO_INGEST } from './meteo.queues';

/** ISO-8601 UTC text for a timestamptz column (postgres.js would hand back a driver-shaped value). */
export const isoSql = (col: SQL): SQL =>
  sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const epochMsSql = (col: SQL): SQL => sql`(extract(epoch from ${col}) * 1000)::float8`;
const tsParam = (ms: number): SQL => sql`${new Date(ms).toISOString()}::timestamptz`;

/** jsonb normally arrives parsed; tolerate a driver that hands back text. */
export function asJson<T>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

export interface OpenCellEvent {
  eventId: string;
  orgId: string;
  harvestedAtMs: number;
}

export interface OpenCell extends RoundedCoord {
  events: OpenCellEvent[];
  earliestHarvestMs: number;
}

interface EventRow {
  eventId: string;
  orgId: string;
  parcelId: string;
  harvestedAtMs: number;
  swathType: SwathType;
  lat: number | null;
  lon: number | null;
  areaHa: number | null;
}

interface AssembledSeries {
  past: WeatherSeries;
  futures: WeatherSeries[];
  rainProb: Map<number, number> | null;
  issuedAt: Record<string, number | null>;
  newestIssuedMs: number | null;
}

/** Union of two stores by hour label; non-null values of `overlay` win. */
export function mergeStores(
  base: HourlyStore | null,
  overlay: HourlyStore | null,
): HourlyStore | null {
  if (!base) return overlay;
  if (!overlay) return base;
  const fields = new Set<string>();
  for (const s of [base, overlay]) for (const k of Object.keys(s)) if (k !== 'time') fields.add(k);
  const rows = new Map<number, Record<string, number | null>>();
  const apply = (s: HourlyStore, isOverlay: boolean): void => {
    s.time.forEach((t, i) => {
      let r = rows.get(t);
      if (!r) {
        r = {};
        for (const f of fields) r[f] = null;
        rows.set(t, r);
      }
      for (const f of fields) {
        const v = s[f]?.[i] ?? null;
        if (!isOverlay || v !== null) r[f] = v ?? r[f];
      }
    });
  };
  apply(base, false);
  apply(overlay, true);
  const time = [...rows.keys()].sort((a, b) => a - b);
  const out: HourlyStore = { time };
  for (const f of fields) out[f] = time.map((t) => rows.get(t)![f]);
  return out;
}

function sliceStore(s: HourlyStore, pred: (t: number) => boolean): HourlyStore {
  const idx: number[] = [];
  s.time.forEach((t, i) => {
    if (pred(t)) idx.push(i);
  });
  const out: HourlyStore = { time: idx.map((i) => s.time[i]) };
  for (const k of Object.keys(s)) if (k !== 'time') out[k] = idx.map((i) => s[k][i] ?? null);
  return out;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function toWeatherSeries(model: string, stepH: number, s: HourlyStore): WeatherSeries {
  const byTime = new Map<number, WeatherHour>();
  s.time.forEach((t, i) => {
    byTime.set(t, {
      t2m: s.t2m?.[i] ?? null,
      rh: s.rh?.[i] ?? null,
      td: s.td?.[i] ?? null,
      windMs: s.wind?.[i] ?? null,
      rsWm2: s.rs?.[i] ?? null,
      precipMm: s.precip?.[i] ?? null,
      sm07: s.sm07?.[i] ?? null,
    });
  });
  return { model, stepH, byTime };
}

const hourUsable = (w: WeatherHour | undefined): w is WeatherHour =>
  !!w && w.t2m !== null && (w.rh !== null || w.td !== null);

/**
 * Data side of the meteo module: forecast ingest storage, the per-event series
 * assembly and the engine run. Everything is derived from the database, so a
 * BullMQ retry (or a different replica) re-reads exactly what it needs.
 */
@Injectable()
export class MeteoDataService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    @InjectQueue(QUEUE_METEO_ENGINE) private readonly engineQueue: Queue,
    @InjectQueue(QUEUE_METEO_INGEST) private readonly ingestQueue: Queue,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  // ── queueing ───────────────────────────────────────────────────────────────

  /** Debounced, best-effort: a Redis hiccup must never fail the user's write. */
  async enqueueEngine(eventId: string): Promise<void> {
    if (!meteoJobsEnabled()) return;
    try {
      await this.engineQueue.add(
        'compute',
        { eventId },
        {
          deduplication: {
            id: `meteo-engine-${eventId}`,
            ttl: METEO_ENQUEUE_DEBOUNCE_MS,
            extend: true,
            replace: true,
          },
          delay: METEO_ENQUEUE_DEBOUNCE_MS,
          removeOnComplete: true,
          removeOnFail: { count: 100 },
          attempts: 2,
        },
      );
    } catch (err) {
      this.winston.warn('Meteo engine enqueue failed', {
        context: 'MeteoDataService',
        eventId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Targeted ingest (a new/backdated drying clock needs its cell's history now). */
  async enqueueIngestForEvent(eventId: string): Promise<void> {
    if (!meteoJobsEnabled()) return;
    try {
      await this.ingestQueue.add(
        'ingest-event',
        { eventId },
        {
          deduplication: { id: `meteo-ingest-${eventId}`, ttl: 10_000 },
          removeOnComplete: true,
          removeOnFail: { count: 100 },
          attempts: 2,
        },
      );
    } catch (err) {
      this.winston.warn('Meteo ingest enqueue failed', {
        context: 'MeteoDataService',
        eventId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── cells ──────────────────────────────────────────────────────────────────

  /**
   * Open drying clocks grouped by forecast cell. Only organizations that opted
   * in AND have meteo + meteo.window enabled (per-org check, never a throw).
   */
  async getOpenCells(onlyEventId?: string): Promise<OpenCell[]> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT
        e.id::text                 AS "eventId",
        e.organization_id::text    AS "orgId",
        ${epochMsSql(sql`e.harvested_at`)} AS "harvestedAtMs",
        COALESCE(ST_Y(p.centroid), ST_Y(ST_PointOnSurface(p.boundary)))::float8 AS lat,
        COALESCE(ST_X(p.centroid), ST_X(ST_PointOnSurface(p.boundary)))::float8 AS lon
      FROM meteo_harvest_events e
      JOIN meteo_org_settings s ON s.organization_id = e.organization_id AND s.enabled
      JOIN parcels p ON p.id = e.parcel_id AND p.organization_id = e.organization_id
                    AND p.deleted_at IS NULL
      WHERE e.closed_at IS NULL AND e.deleted_at IS NULL
        ${onlyEventId ? sql`AND e.id = ${onlyEventId}::uuid` : sql``}
      LIMIT 2000
    `)) as unknown as Array<OpenCellEvent & { lat: number | null; lon: number | null }>;

    const orgOk = new Map<string, boolean>();
    const cells = new Map<string, OpenCell>();
    for (const r of rows) {
      if (r.lat === null || r.lon === null) continue;
      if (!orgOk.has(r.orgId)) {
        orgOk.set(r.orgId, await this.access.isActiveForOrg(r.orgId, 'meteo.window'));
      }
      if (!orgOk.get(r.orgId)) continue;
      const c = roundCoord(r.lat, r.lon);
      let cell = cells.get(c.key);
      if (!cell) {
        cell = { ...c, events: [], earliestHarvestMs: r.harvestedAtMs };
        cells.set(c.key, cell);
      }
      cell.events.push({ eventId: r.eventId, orgId: r.orgId, harvestedAtMs: r.harvestedAtMs });
      cell.earliestHarvestMs = Math.min(cell.earliestHarvestMs, r.harvestedAtMs);
    }
    return [...cells.values()];
  }

  /** What the cache holds for (cell, model): run init time, fetch time, first hour. */
  async getCacheState(
    coordKey: string,
    model: string,
  ): Promise<{ issuedMs: number | null; fetchedMs: number; firstMs: number | null } | null> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT ${epochMsSql(sql`issued_at`)} AS "issuedMs",
             ${epochMsSql(sql`fetched_at`)} AS "fetchedMs",
             (hourly->'time'->>0)::float8   AS "firstMs"
      FROM meteo_forecast_latest
      WHERE coord_key = ${coordKey} AND model = ${model}
      LIMIT 1
    `)) as unknown as Array<{ issuedMs: number | null; fetchedMs: number; firstMs: number | null }>;
    return rows[0] ?? null;
  }

  // ── ingest storage ─────────────────────────────────────────────────────────

  /** Upsert the latest response and merge its past hours into the day history. */
  async storeIngested(
    cell: RoundedCoord,
    model: string,
    stepH: number,
    issuedMs: number,
    store: HourlyStore,
    nowMs: number,
  ): Promise<void> {
    const db = this.drizzleProvider.db;
    await db.execute(sql`
      INSERT INTO meteo_forecast_latest (coord_key, model, lat, lon, issued_at, fetched_at, step_h, hourly)
      VALUES (${cell.key}, ${model}, ${cell.lat}, ${cell.lon}, ${tsParam(issuedMs)}, now(),
              ${stepH}, ${JSON.stringify(store)}::jsonb)
      ON CONFLICT (coord_key, model) DO UPDATE SET
        issued_at = EXCLUDED.issued_at, fetched_at = now(), step_h = EXCLUDED.step_h,
        hourly = EXCLUDED.hourly
    `);

    const past = sliceStore(store, (t) => t <= nowMs);
    if (past.time.length === 0) return;
    const byDay = new Map<string, HourlyStore>();
    for (const day of new Set(past.time.map(utcDay))) {
      byDay.set(
        day,
        sliceStore(past, (t) => utcDay(t) === day),
      );
    }
    const days = [...byDay.keys()].sort();
    const existing = (await db.execute(sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, hourly
      FROM meteo_cell_history
      WHERE coord_key = ${cell.key} AND model = ${model}
        AND day >= ${days[0]}::date AND day <= ${days[days.length - 1]}::date
      LIMIT 100
    `)) as unknown as Array<{ day: string; hourly: unknown }>;
    const stored = new Map(existing.map((r) => [r.day, asJson<HourlyStore>(r.hourly)]));

    for (const [day, fresh] of byDay) {
      const prev = stored.get(day) ?? null;
      const merged = mergeStores(prev, fresh)!;
      const text = JSON.stringify(merged);
      if (prev && JSON.stringify(prev) === text) continue;
      await db.execute(sql`
        INSERT INTO meteo_cell_history (coord_key, model, day, hourly)
        VALUES (${cell.key}, ${model}, ${day}::date, ${text}::jsonb)
        ON CONFLICT (coord_key, model, day) DO UPDATE SET hourly = EXCLUDED.hourly, updated_at = now()
      `);
    }
  }

  // ── series assembly ────────────────────────────────────────────────────────

  private async assembleSeries(
    cell: RoundedCoord,
    harvestedAtMs: number,
    nowMs: number,
  ): Promise<AssembledSeries> {
    const db = this.drizzleProvider.db;
    const fromDay = utcDay(harvestedAtMs - 24 * HOUR_MS);
    const toDay = utcDay(nowMs);
    const [latestRows, histRows] = await Promise.all([
      db.execute(sql`
        SELECT model, ${epochMsSql(sql`issued_at`)} AS "issuedMs", step_h AS "stepH", hourly
        FROM meteo_forecast_latest
        WHERE coord_key = ${cell.key}
        LIMIT 10
      `) as unknown as Promise<
        Array<{ model: string; issuedMs: number | null; stepH: number; hourly: unknown }>
      >,
      db.execute(sql`
        SELECT model, hourly
        FROM meteo_cell_history
        WHERE coord_key = ${cell.key} AND day >= ${fromDay}::date AND day <= ${toDay}::date
        ORDER BY day
        LIMIT 200
      `) as unknown as Promise<Array<{ model: string; hourly: unknown }>>,
    ]);

    const merged = new Map<string, HourlyStore>();
    for (const r of histRows) {
      merged.set(r.model, mergeStores(merged.get(r.model) ?? null, asJson<HourlyStore>(r.hourly))!);
    }
    const issuedAt: Record<string, number | null> = {};
    const stepOf = new Map<string, number>();
    for (const r of latestRows) {
      merged.set(r.model, mergeStores(merged.get(r.model) ?? null, asJson<HourlyStore>(r.hourly))!);
      issuedAt[r.model] = r.issuedMs;
      stepOf.set(r.model, r.stepH);
    }

    // Past: primary model, per hour falling back to icon_eu when the primary
    // has no usable value for that hour.
    const prim = merged.get(PRIMARY_MODEL_KEY);
    const alt = merged.get(FALLBACK_MODEL_KEY);
    const primW = prim
      ? toWeatherSeries(PRIMARY_MODEL_KEY, 1, prim).byTime
      : new Map<number, WeatherHour>();
    const altW = alt
      ? toWeatherSeries(FALLBACK_MODEL_KEY, 1, alt).byTime
      : new Map<number, WeatherHour>();
    const stitched = new Map<number, WeatherHour>();
    for (const t of new Set([...primW.keys(), ...altW.keys()])) {
      const a = primW.get(t);
      const b = altW.get(t);
      const pick = hourUsable(a) ? a : hourUsable(b) ? b : (a ?? b);
      if (pick) stitched.set(t, pick);
    }

    // Futures: every hourly model that still has numbers after "now".
    const futures: WeatherSeries[] = [];
    for (const key of [PRIMARY_MODEL_KEY, FALLBACK_MODEL_KEY]) {
      const s = merged.get(key);
      if (!s) continue;
      const ws = toWeatherSeries(key, stepOf.get(key) ?? 1, s);
      let hasFuture = false;
      for (const [t, w] of ws.byTime) {
        if (t > nowMs && w.t2m !== null) {
          hasFuture = true;
          break;
        }
      }
      if (hasFuture) futures.push(ws);
    }

    // Rain probability: 3-hourly ensemble value held across its block.
    let rainProb: Map<number, number> | null = null;
    const rp = merged.get(RAIN_PROB_MODEL.key);
    if (rp?.pp) {
      const m = new Map<number, number>();
      rp.time.forEach((t, i) => {
        const v = rp.pp[i];
        if (v !== null && v !== undefined) m.set(t, Math.min(1, Math.max(0, v)));
      });
      for (const [t, v] of [...m]) {
        for (const back of [1, 2]) {
          const tt = t - back * HOUR_MS;
          if (!m.has(tt)) m.set(tt, v);
        }
      }
      if (m.size > 0) rainProb = m;
    }

    const used = [PRIMARY_MODEL_KEY, FALLBACK_MODEL_KEY, RAIN_PROB_MODEL.key];
    const issuedVals = used
      .map((k) => issuedAt[k])
      .filter((x): x is number => typeof x === 'number');
    return {
      past: { model: PRIMARY_MODEL_KEY, stepH: 1, byTime: stitched },
      futures,
      rainProb,
      issuedAt,
      newestIssuedMs: issuedVals.length ? Math.max(...issuedVals) : null,
    };
  }

  // ── engine run ─────────────────────────────────────────────────────────────

  private async writeResult(
    ev: EventRow,
    nowMs: number,
    hourlyLatest: MeteoHourPoint[],
    hourlySnapshot: MeteoHourPoint[] | null,
    basis: Record<string, unknown>,
    mc0: { source: string; atMs: number } | null,
    requiredHours: number | null,
  ): Promise<void> {
    const db = this.drizzleProvider.db;
    await db.execute(sql`
      INSERT INTO meteo_straw_latest
        (harvest_event_id, organization_id, computed_at, basis, mc0_source, mc0_at, required_hours, hourly, model_version)
      VALUES (${ev.eventId}::uuid, ${ev.orgId}::uuid, ${tsParam(nowMs)}, ${JSON.stringify(basis)}::jsonb,
              ${mc0?.source ?? null}, ${mc0 ? tsParam(mc0.atMs) : sql`NULL`}, ${requiredHours},
              ${JSON.stringify(hourlyLatest)}::jsonb, ${METEO_MODEL_VERSION})
      ON CONFLICT (harvest_event_id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id, computed_at = EXCLUDED.computed_at,
        basis = EXCLUDED.basis, mc0_source = EXCLUDED.mc0_source, mc0_at = EXCLUDED.mc0_at,
        required_hours = EXCLUDED.required_hours, hourly = EXCLUDED.hourly,
        model_version = EXCLUDED.model_version
    `);
    if (hourlySnapshot) {
      await db.execute(sql`
        INSERT INTO meteo_straw_snapshots
          (harvest_event_id, organization_id, computed_at, basis, required_hours, hourly, model_version)
        VALUES (${ev.eventId}::uuid, ${ev.orgId}::uuid, ${tsParam(nowMs)}, ${JSON.stringify(basis)}::jsonb,
                ${requiredHours}, ${JSON.stringify(hourlySnapshot)}::jsonb, ${METEO_MODEL_VERSION})
      `);
    }
  }

  /** Re-reads everything from the database and refreshes straw_latest (+ a snapshot). */
  async computeEvent(eventId: string): Promise<void> {
    const db = this.drizzleProvider.db;
    const evRows = (await db.execute(sql`
      SELECT
        e.id::text AS "eventId", e.organization_id::text AS "orgId", e.parcel_id::text AS "parcelId",
        ${epochMsSql(sql`e.harvested_at`)} AS "harvestedAtMs", e.swath_type AS "swathType",
        COALESCE(ST_Y(p.centroid), ST_Y(ST_PointOnSurface(p.boundary)))::float8 AS lat,
        COALESCE(ST_X(p.centroid), ST_X(ST_PointOnSurface(p.boundary)))::float8 AS lon,
        COALESCE(p.area_hectares, ST_Area(p.boundary::geography) / 10000)::float8 AS "areaHa"
      FROM meteo_harvest_events e
      JOIN parcels p ON p.id = e.parcel_id AND p.organization_id = e.organization_id
      WHERE e.id = ${eventId}::uuid AND e.deleted_at IS NULL AND e.closed_at IS NULL
      LIMIT 1
    `)) as unknown as EventRow[];
    const ev = evRows[0];
    if (!ev) return;
    if (!(await this.access.isActiveForOrg(ev.orgId, 'meteo.window'))) return;

    const settings = await this.access.getSettings(ev.orgId);
    const nowMs = Date.now();
    const requiredHours = requiredHoursFor(ev.areaHa, settings.pressCapacityHaH);
    const emptyBasis = (blocking: MeteoReason): Record<string, unknown> => ({
      models: [],
      issuedAt: {},
      newestIssuedAt: null,
      branch: null,
      rainProbSource: 'none',
      pastHours: 0,
      missingPastHours: 0,
      blocking,
    });

    if (ev.lat === null || ev.lon === null) {
      await this.writeResult(
        ev,
        nowMs,
        [],
        null,
        emptyBasis({ key: 'noCoordinates' }),
        null,
        requiredHours,
      );
      return;
    }

    const cell = roundCoord(ev.lat, ev.lon);
    const series = await this.assembleSeries(cell, ev.harvestedAtMs, nowMs);
    if (series.futures.length === 0) {
      await this.writeResult(
        ev,
        nowMs,
        [],
        null,
        emptyBasis({ key: 'noForecast' }),
        null,
        requiredHours,
      );
      return;
    }

    const readings = (await db.execute(sql`
      SELECT ${epochMsSql(sql`measured_at`)} AS "measuredAtMs", moisture_wb::float8 AS "moistureWb", kind
      FROM meteo_moisture_readings
      WHERE organization_id = ${ev.orgId}::uuid AND parcel_id = ${ev.parcelId}::uuid
        AND deleted_at IS NULL
        AND measured_at >= ${tsParam(ev.harvestedAtMs - 12 * HOUR_MS)}
      ORDER BY measured_at
      LIMIT 500
    `)) as unknown as EngineReading[];

    let result;
    try {
      result = runStrawEngine({
        harvestedAtMs: ev.harvestedAtMs,
        nowMs,
        past: series.past,
        futures: series.futures,
        rainProb: series.rainProb,
        readings,
        swathType: ev.swathType,
        thresholdWb: settings.thresholdWb,
        defaultMc0Wb: settings.defaultMc0Wb,
        params: STRAW_PARAMS_V1,
      });
    } catch (err) {
      this.winston.error('Meteo engine run failed', {
        context: 'MeteoDataService',
        eventId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      // Degrade to an explicit grey instead of leaving the last result to go
      // silently stale: one bad upstream value must be visible, not frozen.
      await this.writeResult(ev, nowMs, [], null, emptyBasis({ key: 'engineError' }), null, requiredHours);
      return;
    }

    const missingShare = result.pastHours > 0 ? result.missingPastHours / result.pastHours : 0;
    const issuedIso: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(series.issuedAt))
      issuedIso[k] = v === null ? null : new Date(v).toISOString();
    const basis: Record<string, unknown> = {
      models: result.models,
      issuedAt: issuedIso,
      newestIssuedAt:
        series.newestIssuedMs === null ? null : new Date(series.newestIssuedMs).toISOString(),
      branch: new Date(result.branchMs).toISOString(),
      rainProbSource: result.rainProbSource,
      pastHours: result.pastHours,
      missingPastHours: result.missingPastHours,
      blocking:
        missingShare > MAX_MISSING_PAST_SHARE ? ({ key: 'noHistory' } satisfies MeteoReason) : null,
    };

    const points = markBaleableHours(result.points, settings);
    const latest = points.filter((p) => {
      const t = Date.parse(p.time);
      return t >= nowMs - 48 * HOUR_MS && t <= nowMs + 7 * 24 * HOUR_MS;
    });
    const snapshot = points.filter((p) => {
      const t = Date.parse(p.time);
      return t >= nowMs - 48 * HOUR_MS && t <= nowMs + 72 * HOUR_MS;
    });
    await this.writeResult(
      ev,
      nowMs,
      latest,
      snapshot,
      basis,
      { source: result.mc0Source, atMs: result.mc0AtMs },
      requiredHours,
    );
    this.winston.log('flow', 'Meteo engine run', {
      context: 'MeteoDataService',
      eventId,
      models: result.models,
      pastHours: result.pastHours,
      missingPastHours: result.missingPastHours,
      blocking: basis.blocking,
    });
  }
}
