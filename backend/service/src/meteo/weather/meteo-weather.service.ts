import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  HOUR_MS,
  fieldWorkability,
  frostRisk,
  heatStress,
  sprayHour,
  sprayWindows,
  stormRisk,
  waterBalance,
  weatherIcon,
} from '@strawboss/domain';
import {
  METEO_ATTRIBUTION,
  isFeatureEnabled,
  type MeteoAgroIndicators,
  type MeteoParcelWeather,
  type MeteoParcelWeatherCompact,
  type MeteoSprayWindow,
  type MeteoWeatherCurrent,
  type MeteoWeatherDay,
  type MeteoWeatherHour,
} from '@strawboss/types';
import { DrizzleProvider } from '../../database/drizzle.provider';
import { FeatureDisabledException } from '../../features/feature-disabled.exception';
import { MeteoAccessService } from '../meteo-access.service';
import { MeteoClient } from '../meteo-client';
import { cellFor, localDate } from './grid';
import { MeteoUpstreamService } from './meteo-upstream.service';
import { MeteoWeatherCacheService, WX_KEY_PREFIX } from './meteo-weather-cache.service';
import {
  PARCEL_DAILY_SPEC,
  PARCEL_HOURLY_SPEC,
  normaliseParcelDaily,
  normaliseParcelHourly,
  type ParcelHourlyPayload,
  type WxCurrent,
  type WxDay,
  type WxHour,
} from './weather.specs';

const PH_FRESH_MS = 45 * 60_000;
const PH_MAX_MS = 6 * 3_600_000;
const PD_FRESH_MS = 3 * 3_600_000;
const PD_MAX_MS = 24 * 3_600_000;
const FLOOR = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;
const iso = (ms: number): string => new Date(ms).toISOString();

interface ParcelRow {
  name: string | null;
  code: string | null;
  cropType: string | null;
  lat: number | null;
  lon: number | null;
}

function sum(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null;
}

@Injectable()
export class MeteoWeatherService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly access: MeteoAccessService,
    private readonly client: MeteoClient,
    private readonly cache: MeteoWeatherCacheService,
    private readonly upstream: MeteoUpstreamService,
  ) {}

  /**
   * Fail-closed even though these are reads: they spend external quota.
   * 503 METEO_NOT_CONFIGURED → 403 FEATURE_DISABLED (not opted in / switch off).
   */
  async assertWeatherAccess(orgId: string, disabledFeatures: readonly string[]): Promise<void> {
    if (!this.client.configured) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'METEO_NOT_CONFIGURED',
        message: 'Serviciul meteo nu este configurat.',
      });
    }
    if (
      !isFeatureEnabled(disabledFeatures, 'meteo') ||
      !isFeatureEnabled(disabledFeatures, 'meteo.forecast') ||
      !(await this.access.isOptedIn(orgId))
    ) {
      throw new FeatureDisabledException('meteo.forecast');
    }
  }

  private async loadParcel(orgId: string, parcelId: string): Promise<ParcelRow> {
    const rows = (await this.drizzleProvider.db.execute(sql`
      SELECT p.name, p.code, p.crop_type::text AS "cropType",
        COALESCE(ST_Y(p.centroid), ST_Y(ST_PointOnSurface(p.boundary)))::float8 AS lat,
        COALESCE(ST_X(p.centroid), ST_X(ST_PointOnSurface(p.boundary)))::float8 AS lon
      FROM parcels p
      WHERE p.id = ${parcelId}::uuid AND p.organization_id = ${orgId}::uuid AND p.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as ParcelRow[];
    if (!rows[0]) throw new NotFoundException('Parcel not found');
    return rows[0];
  }

  async getParcelWeather(
    orgId: string,
    parcelId: string,
    view: 'full' | 'compact' = 'full',
  ): Promise<MeteoParcelWeather | MeteoParcelWeatherCompact> {
    const parcel = await this.loadParcel(orgId, parcelId);
    const cell =
      parcel.lat !== null && parcel.lon !== null ? cellFor(parcel.lat, parcel.lon, 0.02) : null;

    let ph: ParcelHourlyPayload | null = null;
    let pd: WxDay[] | null = null;
    let phAt: number | null = null;
    let pdAt: number | null = null;
    let stale = false;
    if (cell) {
      const [a, b] = await Promise.all([
        this.cache.getOrRefresh<ParcelHourlyPayload>(`${WX_KEY_PREFIX}:ph:${cell.key}`, {
          freshMs: PH_FRESH_MS,
          staleMaxMs: PH_MAX_MS,
          lane: 'interactive',
          fetch: async () => {
            const locs = await this.upstream.forecast(PARCEL_HOURLY_SPEC, [cell], 'interactive');
            return normaliseParcelHourly(locs?.[0]);
          },
        }),
        this.cache.getOrRefresh<WxDay[]>(`${WX_KEY_PREFIX}:pd:${cell.key}`, {
          freshMs: PD_FRESH_MS,
          staleMaxMs: PD_MAX_MS,
          lane: 'interactive',
          fetch: async () => {
            const locs = await this.upstream.forecast(PARCEL_DAILY_SPEC, [cell], 'interactive');
            return normaliseParcelDaily(locs?.[0], localDate);
          },
        }),
      ]);
      ph = a.value;
      phAt = a.fetchedAtMs;
      pd = b.value;
      pdAt = b.fetchedAtMs;
      stale = a.stale || b.stale;
    }

    const now = Date.now();
    const built = this.build(ph, pd, now);

    if (view === 'compact') {
      return {
        parcelId,
        fetchedAt: phAt ? iso(phAt) : null,
        stale,
        current: built.current,
        attribution: METEO_ATTRIBUTION,
        next12h: built.hourly
          .slice(0, 12)
          .map((h) => ({
            time: h.time,
            tempC: h.tempC,
            precipMm: h.precipMm,
            precipProb: h.precipProb,
            icon: h.icon,
          })),
        days: built.daily.slice(0, 3),
        spray: built.agro?.spray.next ?? null,
        frost: built.agro?.frost.level ?? 'none',
        rain24hMm: built.agro?.workability.rainNext24hMm ?? null,
      } satisfies MeteoParcelWeatherCompact;
    }

    return {
      parcelId,
      parcelName: parcel.name,
      parcelCode: parcel.code,
      cropType: parcel.cropType,
      location: cell ? { lat: cell.lat, lon: cell.lon, cellKey: cell.key } : null,
      fetchedAt: phAt ? iso(phAt) : null,
      dailyFetchedAt: pdAt ? iso(pdAt) : null,
      stale,
      publicApi: this.client.publicApi,
      current: built.current,
      hourly: built.hourly,
      daily: built.daily,
      agro: built.agro,
      attribution: METEO_ATTRIBUTION,
    } satisfies MeteoParcelWeather;
  }

  private build(
    ph: ParcelHourlyPayload | null,
    pd: WxDay[] | null,
    now: number,
  ): {
    current: MeteoWeatherCurrent | null;
    hourly: MeteoWeatherHour[];
    daily: MeteoWeatherDay[];
    agro: MeteoAgroIndicators | null;
  } {
    const daily: MeteoWeatherDay[] = (pd ?? []).slice(0, 16).map((d) => ({
      ...d,
      icon: weatherIcon(d.weatherCode, true),
    }));
    if (!ph) return { current: null, hourly: [], daily, agro: null };

    const all: WxHour[] = [...ph.hours].sort((a, b) => a.timeMs - b.timeMs);
    const from = FLOOR(now);
    const sprayAt = (i: number): boolean | null => sprayHour(all, i).ok;
    const hourly: MeteoWeatherHour[] = [];
    for (let i = 0; i < all.length; i++) {
      const h = all[i];
      if (h.timeMs < from || h.timeMs >= from + 48 * HOUR_MS) continue;
      hourly.push({
        time: iso(h.timeMs),
        tempC: h.tempC,
        rh: h.rh,
        dewPointC: h.dewPointC,
        precipMm: h.precipMm,
        precipProb: h.precipProb,
        weatherCode: h.weatherCode,
        icon: weatherIcon(h.weatherCode, h.isDay),
        windMs: h.windMs,
        gustMs: h.gustMs,
        windDirDeg: h.windDirDeg,
        soilTemp0C: h.soilTemp0C,
        soilMoist0to1: h.soilMoist0to1,
        soilMoist3to9: h.soilMoist3to9,
        capeJkg: h.capeJkg,
        vpdKPa: h.vpdKPa,
        leafWetProb: h.leafWetProb,
        isDay: h.isDay,
        sprayOk: sprayAt(i),
      });
    }

    const nowHour = all.find((h) => h.timeMs === from) ?? null;
    const c: WxCurrent | null =
      ph.current ??
      (nowHour
        ? {
            timeMs: nowHour.timeMs,
            tempC: nowHour.tempC,
            apparentC: null,
            rh: nowHour.rh,
            precipMm: nowHour.precipMm,
            weatherCode: nowHour.weatherCode,
            cloudCover: null,
            windMs: nowHour.windMs,
            gustMs: nowHour.gustMs,
            windDirDeg: nowHour.windDirDeg,
            isDay: nowHour.isDay,
          }
        : null);
    const current: MeteoWeatherCurrent | null = c
      ? {
          time: iso(c.timeMs),
          tempC: c.tempC,
          apparentC: c.apparentC,
          rh: c.rh,
          precipMm: c.precipMm,
          weatherCode: c.weatherCode,
          icon: weatherIcon(c.weatherCode, c.isDay),
          cloudCover: c.cloudCover,
          windMs: c.windMs,
          gustMs: c.gustMs,
          windDirDeg: c.windDirDeg,
          isDay: c.isDay,
        }
      : null;

    const rainPast48h = sum(
      all.filter((h) => h.timeMs < from && h.timeMs >= from - 48 * HOUR_MS).map((h) => h.precipMm),
    );
    const next24 = all.filter((h) => h.timeMs >= from && h.timeMs < from + 24 * HOUR_MS);
    const rainNext24h = next24.length ? sum(next24.map((h) => h.precipMm)) : null;

    const nowIdx = all.findIndex((h) => h.timeMs === from);
    const nowSpray = nowIdx >= 0 ? sprayHour(all, nowIdx) : { ok: null, reasons: ['no_data'] };
    const windows: MeteoSprayWindow[] = sprayWindows(all, now).map((w) => ({
      start: iso(w.startMs),
      end: iso(w.endMs),
      hours: w.hours,
    }));
    const wk = fieldWorkability({
      soilMoist0to1: nowHour?.soilMoist0to1 ?? null,
      soilMoist3to9: nowHour?.soilMoist3to9 ?? null,
      rainPast48hMm: rainPast48h,
      rainNext24hMm: rainNext24h,
    });
    const frost = frostRisk(all, now);
    const storm = stormRisk(all, now);
    const heat = heatStress(daily);
    const agro: MeteoAgroIndicators = {
      spray: {
        windows,
        next: windows.find((w) => Date.parse(w.end) > now) ?? null,
        nowOk: nowSpray.ok,
        nowReasons: nowSpray.reasons as string[],
      },
      workability: {
        level: wk.level,
        soilMoist: wk.soilMoist,
        rainPast48hMm: rainPast48h,
        rainNext24hMm: rainNext24h,
        reasons: wk.reasons,
      },
      frost: {
        level: frost.level,
        minAirC: frost.minAirC,
        minSoilC: frost.minSoilC,
        at: frost.atMs !== null ? iso(frost.atMs) : null,
      },
      heat: { level: heat.level, tMaxC: heat.tMaxC, date: heat.date },
      storm: {
        level: storm.level,
        maxCapeJkg: storm.maxCapeJkg,
        precipProb: storm.precipProb,
        at: storm.atMs !== null ? iso(storm.atMs) : null,
      },
      waterBalance: waterBalance(daily),
    };
    return { current, hourly, daily, agro };
  }
}
