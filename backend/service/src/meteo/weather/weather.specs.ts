import type { AgroHour } from '@strawboss/domain';

/**
 * Open-Meteo variable lists + normalisers for the interactive weather feature.
 * Percent fields become FRACTIONS, sunshine/daylight seconds become hours.
 * Normalised payloads are what the Redis cache stores (compact, JSON-safe).
 */

export interface ForecastSpec {
  current?: readonly string[];
  hourly?: readonly string[];
  daily?: readonly string[];
  pastHours?: number;
  forecastHours?: number;
  forecastDays?: number;
}

export const PARCEL_HOURLY_SPEC = {
  current: [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'precipitation',
    'weather_code',
    'cloud_cover',
    'wind_speed_10m',
    'wind_gusts_10m',
    'wind_direction_10m',
    'is_day',
  ],
  hourly: [
    'temperature_2m',
    'relative_humidity_2m',
    'dew_point_2m',
    'precipitation',
    'precipitation_probability',
    'weather_code',
    'wind_speed_10m',
    'wind_gusts_10m',
    'wind_direction_10m',
    'soil_temperature_0cm',
    'soil_moisture_0_to_1cm',
    'soil_moisture_3_to_9cm',
    'cape',
    'vapour_pressure_deficit',
    'leaf_wetness_probability',
    'is_day',
  ],
  pastHours: 48,
  forecastHours: 72,
} as const satisfies ForecastSpec;

export const PARCEL_DAILY_SPEC = {
  daily: [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'precipitation_probability_max',
    'precipitation_hours',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'wind_direction_10m_dominant',
    'shortwave_radiation_sum',
    'sunshine_duration',
    'daylight_duration',
    'sunrise',
    'sunset',
    'et0_fao_evapotranspiration',
    'uv_index_max',
  ],
  forecastDays: 16,
} as const satisfies ForecastSpec;

/** Exactly 10 variables → quota weight 1 per location. */
export const FARM_CELL_SPEC = {
  current: ['temperature_2m', 'weather_code', 'wind_gusts_10m', 'is_day'],
  hourly: ['precipitation', 'precipitation_probability', 'wind_gusts_10m', 'temperature_2m', 'cape', 'soil_temperature_0cm'],
  forecastHours: 48,
} as const satisfies ForecastSpec;

export const CLIMATE_VARS = ['temperature_2m_mean', 'precipitation_sum'] as const;
export const CLIMATE_NORMALS_SPEC = {
  startDate: '1991-01-01',
  endDate: '2020-12-31',
  daily: CLIMATE_VARS,
} as const;
/** Same variables; the date range is supplied per call. */
export const CLIMATE_DAILY_SPEC = { daily: CLIMATE_VARS } as const;

// ── Normalised payloads ────────────────────────────────────────────────────

export interface WxCurrent {
  timeMs: number;
  tempC: number | null;
  apparentC: number | null;
  rh: number | null;
  precipMm: number | null;
  weatherCode: number | null;
  cloudCover: number | null;
  windMs: number | null;
  gustMs: number | null;
  windDirDeg: number | null;
  isDay: boolean | null;
}

export interface WxHour extends AgroHour {
  rh: number | null;
  weatherCode: number | null;
  windDirDeg: number | null;
  vpdKPa: number | null;
}

export interface WxDay {
  date: string;
  weatherCode: number | null;
  tMaxC: number | null;
  tMinC: number | null;
  precipMm: number | null;
  precipProbMax: number | null;
  precipHours: number | null;
  windMaxMs: number | null;
  gustMaxMs: number | null;
  windDirDeg: number | null;
  radiationMJ: number | null;
  sunshineH: number | null;
  daylightH: number | null;
  sunrise: string | null;
  sunset: string | null;
  et0Mm: number | null;
  uvMax: number | null;
}

export interface ParcelHourlyPayload {
  current: WxCurrent | null;
  hours: WxHour[];
}

export interface FarmCellPayload {
  currentTempC: number | null;
  currentCode: number | null;
  currentIsDay: boolean | null;
  hours: AgroHour[];
}

type Raw = Record<string, unknown> | null | undefined;

/** Finite number, rounded to `dp` decimals and scaled; else null. */
function num(v: unknown, dp = 1, scale = 1): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * scale * f) / f;
}

function at(arr: unknown, i: number): unknown {
  return Array.isArray(arr) ? arr[i] : undefined;
}

function bool01(v: unknown): boolean | null {
  return v === 1 || v === true ? true : v === 0 || v === false ? false : null;
}

function isoFromUnix(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null;
}

function normaliseCurrent(c: Raw): WxCurrent | null {
  if (!c || typeof c.time !== 'number') return null;
  return {
    timeMs: c.time * 1000,
    tempC: num(c.temperature_2m),
    apparentC: num(c.apparent_temperature),
    rh: num(c.relative_humidity_2m, 2, 0.01),
    precipMm: num(c.precipitation, 2),
    weatherCode: num(c.weather_code, 0),
    cloudCover: num(c.cloud_cover, 2, 0.01),
    windMs: num(c.wind_speed_10m),
    gustMs: num(c.wind_gusts_10m),
    windDirDeg: num(c.wind_direction_10m, 0),
    isDay: bool01(c.is_day),
  };
}

/** Hourly arrays → AgroHour-shaped rows; rows without a valid timestamp are dropped. */
function normaliseHours(h: Raw): WxHour[] {
  if (!h || !Array.isArray(h.time)) return [];
  const out: WxHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    out.push({
      timeMs: t * 1000,
      tempC: num(at(h.temperature_2m, i)),
      rh: num(at(h.relative_humidity_2m, i), 2, 0.01),
      dewPointC: num(at(h.dew_point_2m, i)),
      precipMm: num(at(h.precipitation, i), 2),
      precipProb: num(at(h.precipitation_probability, i), 2, 0.01),
      weatherCode: num(at(h.weather_code, i), 0),
      windMs: num(at(h.wind_speed_10m, i)),
      gustMs: num(at(h.wind_gusts_10m, i)),
      windDirDeg: num(at(h.wind_direction_10m, i), 0),
      soilTemp0C: num(at(h.soil_temperature_0cm, i)),
      soilMoist0to1: num(at(h.soil_moisture_0_to_1cm, i), 3),
      soilMoist3to9: num(at(h.soil_moisture_3_to_9cm, i), 3),
      capeJkg: num(at(h.cape, i), 0),
      vpdKPa: num(at(h.vapour_pressure_deficit, i), 2),
      leafWetProb: num(at(h.leaf_wetness_probability, i), 2, 0.01),
      isDay: bool01(at(h.is_day, i)),
    });
  }
  return out;
}

export function normaliseParcelHourly(loc: Raw): ParcelHourlyPayload | null {
  if (!loc) return null;
  const hours = normaliseHours(loc.hourly as Raw);
  if (hours.length === 0) return null;
  return { current: normaliseCurrent(loc.current as Raw), hours };
}

export function normaliseParcelDaily(loc: Raw, localDate: (ms: number) => string): WxDay[] | null {
  const d = loc?.daily as Raw;
  if (!d || !Array.isArray(d.time)) return null;
  const out: WxDay[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const t = d.time[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    out.push({
      date: localDate(t * 1000),
      weatherCode: num(at(d.weather_code, i), 0),
      tMaxC: num(at(d.temperature_2m_max, i)),
      tMinC: num(at(d.temperature_2m_min, i)),
      precipMm: num(at(d.precipitation_sum, i)),
      precipProbMax: num(at(d.precipitation_probability_max, i), 2, 0.01),
      precipHours: num(at(d.precipitation_hours, i), 0),
      windMaxMs: num(at(d.wind_speed_10m_max, i)),
      gustMaxMs: num(at(d.wind_gusts_10m_max, i)),
      windDirDeg: num(at(d.wind_direction_10m_dominant, i), 0),
      radiationMJ: num(at(d.shortwave_radiation_sum, i)),
      sunshineH: num(at(d.sunshine_duration, i), 1, 1 / 3600),
      daylightH: num(at(d.daylight_duration, i), 1, 1 / 3600),
      sunrise: isoFromUnix(at(d.sunrise, i)),
      sunset: isoFromUnix(at(d.sunset, i)),
      et0Mm: num(at(d.et0_fao_evapotranspiration, i)),
      uvMax: num(at(d.uv_index_max, i)),
    });
  }
  return out.length ? out : null;
}

export function normaliseFarmCell(loc: Raw): FarmCellPayload | null {
  if (!loc) return null;
  const hours = normaliseHours(loc.hourly as Raw);
  if (hours.length === 0) return null;
  const c = normaliseCurrent(loc.current as Raw);
  return {
    currentTempC: c?.tempC ?? null,
    currentCode: c?.weatherCode ?? null,
    currentIsDay: c?.isDay ?? null,
    hours: hours.map((h) => ({
      timeMs: h.timeMs,
      tempC: h.tempC,
      dewPointC: null,
      precipMm: h.precipMm,
      precipProb: h.precipProb,
      windMs: null,
      gustMs: h.gustMs,
      leafWetProb: null,
      soilTemp0C: h.soilTemp0C,
      soilMoist0to1: null,
      soilMoist3to9: null,
      capeJkg: h.capeJkg,
      isDay: null,
    })),
  };
}

export interface ClimateDay {
  date: string;
  tmeanC: number | null;
  precipMm: number | null;
}

/** Archive `daily` block → rows keyed by ISO date (archive time is already 'YYYY-MM-DD'). */
export function normaliseClimateDaily(daily: Raw): ClimateDay[] {
  if (!daily || !Array.isArray(daily.time)) return [];
  const out: ClimateDay[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      tmeanC: num(at(daily.temperature_2m_mean, i), 2),
      precipMm: num(at(daily.precipitation_sum, i), 2),
    });
  }
  return out;
}
