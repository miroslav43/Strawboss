import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import {
  FORECAST_DAYS,
  METEO_HOURLY_VARS,
  RAIN_PROB_MODEL,
  type HourlyStore,
  type MeteoModelDef,
} from './meteo.constants';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 2;
const META_BASE = 'https://openmeteo.s3.amazonaws.com/data';

/** Open-Meteo's public API is non-commercial — the self-hosted instance only. */
const FORBIDDEN_HOST_SUFFIX = 'open-meteo.com';

export interface RunMeta {
  initMs: number;
  availableMs: number;
}

type ApiHourly = Record<string, unknown>;

function numArray(v: unknown, len: number, scale = 1): (number | null)[] {
  const out: (number | null)[] = new Array(len).fill(null);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < len; i++) {
    const x = v[i];
    out[i] = typeof x === 'number' && Number.isFinite(x) ? x * scale : null;
  }
  return out;
}

/**
 * HTTP client for the SELF-HOSTED Open-Meteo instance (OPEN_METEO_BASE_URL) and
 * for the public S3 run metadata. Never talks to *.open-meteo.com (licence).
 * Fail-soft: every method returns null on any error, logging a warning.
 */
@Injectable()
export class MeteoClient {
  private readonly baseUrl: string | null;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger) {
    this.baseUrl = this.resolveBaseUrl(process.env.OPEN_METEO_BASE_URL);
  }

  /** OPEN_METEO_BASE_URL is set and allowed. */
  get configured(): boolean {
    return this.baseUrl !== null;
  }

  private resolveBaseUrl(raw: string | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host === FORBIDDEN_HOST_SUFFIX || host.endsWith(`.${FORBIDDEN_HOST_SUFFIX}`)) {
        // Logged once (constructor runs once per process).
        this.winston.error(
          'OPEN_METEO_BASE_URL points at open-meteo.com — refused (non-commercial licence). Meteo disabled.',
          { context: 'MeteoClient' },
        );
        return null;
      }
      return value.replace(/\/+$/, '');
    } catch {
      this.winston.error('OPEN_METEO_BASE_URL is not a valid URL — Meteo disabled.', {
        context: 'MeteoClient',
      });
      return null;
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  /** Concurrency-limited, in-flight-deduplicated JSON GET. */
  private getJson<T>(url: string): Promise<T | null> {
    const existing = this.inFlight.get(url);
    if (existing) return existing as Promise<T | null>;
    const p = (async (): Promise<T | null> => {
      await this.acquire();
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          this.winston.warn(`Meteo fetch HTTP ${res.status}`, { context: 'MeteoClient', url });
          return null;
        }
        return (await res.json()) as T;
      } catch (err) {
        this.winston.warn('Meteo fetch failed', {
          context: 'MeteoClient',
          url,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      } finally {
        this.release();
      }
    })().finally(() => {
      this.inFlight.delete(url);
    });
    this.inFlight.set(url, p);
    return p;
  }

  /**
   * Latest run of a model on the public S3 distribution. Returns null when the
   * run is missing OR was marked available less than `minAgeMs` ago (files may
   * still be incomplete).
   */
  async fetchRunMeta(s3Name: string, minAgeMs = 0): Promise<RunMeta | null> {
    const meta = await this.getJson<{
      last_run_initialisation_time?: number;
      last_run_availability_time?: number;
    }>(`${META_BASE}/${encodeURIComponent(s3Name)}/static/meta.json`);
    const init = meta?.last_run_initialisation_time;
    const avail = meta?.last_run_availability_time;
    if (typeof init !== 'number' || typeof avail !== 'number') return null;
    const run = { initMs: init * 1000, availableMs: avail * 1000 };
    if (minAgeMs > 0 && Date.now() - run.availableMs < minAgeMs) return null;
    return run;
  }

  /** One model, one coordinate. Units normalised (rh as a fraction). */
  async fetchModel(
    model: MeteoModelDef,
    lat: number,
    lon: number,
    pastDays: number,
  ): Promise<HourlyStore | null> {
    const hourly = await this.fetchHourly(model, lat, lon, pastDays, METEO_HOURLY_VARS);
    if (!hourly) return null;
    const time = hourly.time;
    const col = (name: string, scale = 1): (number | null)[] =>
      numArray(hourly.raw[name] ?? hourly.raw[`${name}_${model.apiId}`], time.length, scale);
    return {
      time,
      t2m: col('temperature_2m'),
      // NWP 2 m RH occasionally reads a little above 100 % in fog/saturation;
      // the domain engine rejects any RH outside 0..1, so clamp at the edge.
      rh: col('relative_humidity_2m', 0.01).map((v) => (v === null ? null : Math.min(1, Math.max(0, v)))),
      td: col('dew_point_2m'),
      wind: col('wind_speed_10m'),
      rs: col('shortwave_radiation'),
      precip: col('precipitation'),
      sm07: col('soil_moisture_0_to_7cm'),
    };
  }

  /**
   * ECMWF precipitation probability as a fraction ({time, pp}). All-null
   * arrays come back as null so the engine falls back to model votes.
   */
  async fetchRainProb(lat: number, lon: number, pastDays: number): Promise<HourlyStore | null> {
    const hourly = await this.fetchHourly(
      RAIN_PROB_MODEL,
      lat,
      lon,
      pastDays,
      'precipitation_probability',
    );
    if (!hourly) return null;
    const raw =
      hourly.raw.precipitation_probability ??
      hourly.raw[`precipitation_probability_${RAIN_PROB_MODEL.apiId}`];
    const pp = numArray(raw, hourly.time.length, 0.01);
    if (pp.every((x) => x === null)) return null;
    return { time: hourly.time, pp };
  }

  private async fetchHourly(
    model: MeteoModelDef,
    lat: number,
    lon: number,
    pastDays: number,
    vars: string,
  ): Promise<{ time: number[]; raw: ApiHourly } | null> {
    if (!this.baseUrl) return null;
    const qs = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      models: model.apiId,
      hourly: vars,
      wind_speed_unit: 'ms',
      timezone: 'UTC',
      timeformat: 'unixtime',
      forecast_days: String(FORECAST_DAYS),
      past_days: String(pastDays),
    });
    const body = await this.getJson<{ hourly?: ApiHourly }>(
      `${this.baseUrl}/v1/forecast?${qs.toString()}`,
    );
    const h = body?.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    const time = (h.time as unknown[]).map((t) => (typeof t === 'number' ? t * 1000 : NaN));
    if (time.some((t) => !Number.isFinite(t))) return null;
    return { time, raw: h };
  }
}
