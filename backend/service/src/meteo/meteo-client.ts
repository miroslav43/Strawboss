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
import { Limiter } from './weather/limiter';

const REQUEST_TIMEOUT_MS = 20_000;
/** Background status requests (farm cells for alerts, ERA5 archive pulls) — larger payloads. */
const BACKGROUND_STATUS_TIMEOUT_MS = 45_000;
const MAX_CONCURRENT = 2;
const META_BASE = 'https://openmeteo.s3.amazonaws.com/data';
/** Interactive (user-facing) lane: own pool, short timeout that also covers the queue wait. */
const INTERACTIVE_CONCURRENT = 3;
const INTERACTIVE_TIMEOUT_MS = 8_000;
/** Model for self-hosted weather requests (the public API uses best_match instead). */
export const WEATHER_MODEL_SELF_HOSTED = 'ecmwf_ifs';
/** One forecast request carries at most this many coordinates. */
export const MAX_LOCATIONS_PER_REQUEST = 50;

/** `interactive` = a user is waiting (own pool, 8 s); `background` = jobs / cache refresh. */
export type MeteoLane = 'interactive' | 'background';

export interface ForecastRequestSpec {
  lats: number[];
  lons: number[];
  current?: readonly string[];
  hourly?: readonly string[];
  daily?: readonly string[];
  pastHours?: number;
  forecastHours?: number;
  forecastDays?: number;
  timezone?: string;
  /** undefined = client default (best_match on the public API, ecmwf_ifs self-hosted); null = omit. */
  models?: string | null;
}

export interface ArchiveRequestSpec {
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  daily: readonly string[];
  timezone?: string;
}

export interface JsonStatus<T> {
  /** HTTP status, null on a network error / timeout. */
  status: number | null;
  body: T | null;
}

/**
 * Open-Meteo's public API is non-commercial — production uses the self-hosted
 * instance. METEO_ALLOW_PUBLIC_API=true (stack env only) lifts this for the
 * internal proof of concept; the status endpoint then reports `publicApi`.
 */
const FORBIDDEN_HOST_SUFFIX = 'open-meteo.com';

export function meteoPublicApiAllowed(): boolean {
  return process.env.METEO_ALLOW_PUBLIC_API === 'true';
}

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
  /** Archive (ERA5 climatology) host; same licence guard as baseUrl. */
  private readonly archiveBaseUrl: string | null;
  /** True when OPEN_METEO_BASE_URL is the public API (POC mode). */
  private usesPublicApi = false;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly interactive = new Limiter(INTERACTIVE_CONCURRENT);
  private readonly inFlightStatus = new Map<string, Promise<JsonStatus<unknown>>>();

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger) {
    const forecast = this.resolveBaseUrl(process.env.OPEN_METEO_BASE_URL, 'OPEN_METEO_BASE_URL');
    this.baseUrl = forecast.url;
    this.usesPublicApi = forecast.isPublic;
    this.archiveBaseUrl = this.resolveBaseUrl(
      process.env.OPEN_METEO_ARCHIVE_BASE_URL,
      'OPEN_METEO_ARCHIVE_BASE_URL',
    ).url;
  }

  /** OPEN_METEO_BASE_URL is set and allowed. */
  get configured(): boolean {
    return this.baseUrl !== null;
  }

  get publicApi(): boolean {
    return this.usesPublicApi;
  }

  /** OPEN_METEO_ARCHIVE_BASE_URL is set and allowed (climatology). */
  get archiveConfigured(): boolean {
    return this.archiveBaseUrl !== null;
  }

  /** Pure: never touches instance state (the archive URL must not flip the forecast flag). */
  private resolveBaseUrl(
    raw: string | undefined,
    envName: string,
  ): { url: string | null; isPublic: boolean } {
    const value = raw?.trim();
    if (!value) return { url: null, isPublic: false };
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host === FORBIDDEN_HOST_SUFFIX || host.endsWith(`.${FORBIDDEN_HOST_SUFFIX}`)) {
        if (meteoPublicApiAllowed()) {
          this.winston.warn(
            'Meteo POC mode: using the PUBLIC Open-Meteo API (non-commercial terms, ~10k calls/day). Switch to the self-hosted instance before production use.',
            { context: 'MeteoClient', host, env: envName },
          );
          return { url: value.replace(/\/+$/, ''), isPublic: true };
        }
        // Logged once (constructor runs once per process).
        this.winston.error(
          `${envName} points at open-meteo.com — refused (non-commercial licence). Meteo disabled.`,
          { context: 'MeteoClient' },
        );
        return { url: null, isPublic: false };
      }
      return { url: value.replace(/\/+$/, ''), isPublic: false };
    } catch {
      this.winston.error(`${envName} is not a valid URL — Meteo disabled.`, {
        context: 'MeteoClient',
      });
      return { url: null, isPublic: false };
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
   * JSON GET that reports the HTTP status (429 handling, 4xx vs 5xx) instead of
   * collapsing every failure into null. In-flight de-duplicated by URL. The
   * interactive lane's 8 s timeout covers the queue wait too.
   */
  async fetchJsonStatus<T>(url: string, lane: MeteoLane): Promise<JsonStatus<T>> {
    const flightKey = `${lane}|${url}`;
    const existing = this.inFlightStatus.get(flightKey);
    if (existing) return existing as Promise<JsonStatus<T>>;
    const p = (async (): Promise<JsonStatus<T>> => {
      // Interactive: the deadline covers the queue wait (a user is waiting).
      // Background: the shared ingest pool's wait is not abortable, so the
      // deadline starts only once a slot is held — a long queue must not
      // expire a request (e.g. the 30-year archive pull) before it is sent.
      let signal: AbortSignal | null =
        lane === 'interactive' ? AbortSignal.timeout(INTERACTIVE_TIMEOUT_MS) : null;
      let acquired = false;
      try {
        if (lane === 'interactive') await this.interactive.acquire(signal as AbortSignal);
        else await this.acquire();
        acquired = true;
        signal ??= AbortSignal.timeout(BACKGROUND_STATUS_TIMEOUT_MS);
        const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
        if (!res.ok) {
          this.winston.warn(`Meteo fetch HTTP ${res.status}`, { context: 'MeteoClient', url, lane });
          return { status: res.status, body: null };
        }
        return { status: res.status, body: (await res.json()) as T };
      } catch (err) {
        this.winston.warn('Meteo fetch failed', {
          context: 'MeteoClient',
          url,
          lane,
          err: err instanceof Error ? err.message : String(err),
        });
        return { status: null, body: null };
      } finally {
        if (acquired) {
          if (lane === 'interactive') this.interactive.release();
          else this.release();
        }
      }
    })().finally(() => {
      this.inFlightStatus.delete(flightKey);
    });
    this.inFlightStatus.set(flightKey, p);
    return p;
  }

  /** Quota weight of a request: locations × max(1, vars/10 × max(1, days/14)). */
  static estimateWeight(i: { nVars: number; nDays: number; nLocations: number }): number {
    return i.nLocations * Math.max(1, (i.nVars / 10) * Math.max(1, i.nDays / 14));
  }

  /**
   * /v1/forecast for one or several coordinates. The API answers an object for
   * one location and an ARRAY for several — both are normalised to an array in
   * request order.
   */
  async requestForecast(
    spec: ForecastRequestSpec,
    lane: MeteoLane,
  ): Promise<{ status: number | null; locations: Array<Record<string, unknown>> | null }> {
    if (!this.baseUrl || spec.lats.length === 0 || spec.lats.length !== spec.lons.length) {
      return { status: null, locations: null };
    }
    const models =
      spec.models === undefined
        ? this.usesPublicApi
          ? null
          : WEATHER_MODEL_SELF_HOSTED
        : spec.models;
    const qs = new URLSearchParams({
      latitude: spec.lats.map((v) => v.toFixed(4)).join(','),
      longitude: spec.lons.map((v) => v.toFixed(4)).join(','),
      wind_speed_unit: 'ms',
      timezone: spec.timezone ?? 'Europe/Bucharest',
      timeformat: 'unixtime',
    });
    if (models) qs.set('models', models);
    if (spec.current?.length) qs.set('current', spec.current.join(','));
    if (spec.hourly?.length) qs.set('hourly', spec.hourly.join(','));
    if (spec.daily?.length) qs.set('daily', spec.daily.join(','));
    if (spec.pastHours !== undefined) qs.set('past_hours', String(spec.pastHours));
    if (spec.forecastHours !== undefined) qs.set('forecast_hours', String(spec.forecastHours));
    if (spec.forecastDays !== undefined) qs.set('forecast_days', String(spec.forecastDays));
    const { status, body } = await this.fetchJsonStatus<unknown>(
      `${this.baseUrl}/v1/forecast?${qs.toString()}`,
      lane,
    );
    if (body === null || typeof body !== 'object') return { status, locations: null };
    const locations = (Array.isArray(body) ? body : [body]) as Array<Record<string, unknown>>;
    return { status, locations };
  }

  /** /v1/archive (ERA5) daily series for one coordinate. */
  async requestArchive(
    spec: ArchiveRequestSpec,
    lane: MeteoLane = 'background',
  ): Promise<{ status: number | null; daily: Record<string, unknown> | null }> {
    if (!this.archiveBaseUrl) return { status: null, daily: null };
    const qs = new URLSearchParams({
      latitude: spec.lat.toFixed(4),
      longitude: spec.lon.toFixed(4),
      start_date: spec.startDate,
      end_date: spec.endDate,
      daily: spec.daily.join(','),
      timezone: spec.timezone ?? 'Europe/Bucharest',
    });
    const { status, body } = await this.fetchJsonStatus<{ daily?: Record<string, unknown> }>(
      `${this.archiveBaseUrl}/v1/archive?${qs.toString()}`,
      lane,
    );
    const daily = body?.daily;
    return { status, daily: daily && Array.isArray(daily.time) ? daily : null };
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
