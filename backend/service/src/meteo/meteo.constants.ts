import { STRAW_PARAMS_V1 } from '@strawboss/domain';
import type { MeteoOrgSettings } from '@strawboss/types';

/**
 * A forecast model used as a consensus member. `apiId` is the Open-Meteo API
 * model id, `s3` the directory name on the public distribution (meta.json).
 * See MODELS.md for how each was verified.
 */
export interface MeteoModelDef {
  /** Key stored in meteo_forecast_latest.model / meteo_cell_history.model. */
  key: string;
  apiId: string;
  s3: string;
  stepH: number;
}

/** First entry is the PRIMARY model (also the source of the past series). */
export const METEO_MODELS: readonly MeteoModelDef[] = [
  { key: 'ecmwf_ifs', apiId: 'ecmwf_ifs', s3: 'ecmwf_ifs', stepH: 1 },
  { key: 'icon_eu', apiId: 'icon_eu', s3: 'dwd_icon_eu', stepH: 1 },
];

export const PRIMARY_MODEL_KEY = METEO_MODELS[0].key;
export const FALLBACK_MODEL_KEY = METEO_MODELS[1].key;

/**
 * Rain probability: only the ECMWF 0.25° ensemble distribution carries
 * `precipitation_probability` (3-hourly). Stored under its own model key.
 * UNCONFIRMED on the self-hosted instance — see MODELS.md (step 0, test 2).
 */
export const RAIN_PROB_MODEL: MeteoModelDef = {
  key: 'rain_prob',
  apiId: 'ecmwf_ifs025',
  s3: 'ecmwf_ifs025_ensemble',
  stepH: 3,
};

export const METEO_MODEL_VERSION = STRAW_PARAMS_V1.modelVersion;

export const METEO_HOURLY_VARS =
  'temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,shortwave_radiation,precipitation,soil_moisture_0_to_7cm';

/** A model run is usable only this long after Open-Meteo marked it available. */
export const RUN_AVAILABILITY_MIN_AGE_MS = 10 * 60_000;

export const FORECAST_DAYS = 7;
export const PAST_DAYS_MIN = 2;
export const PAST_DAYS_MAX = 30;

/** Grid of the shared forecast cache (~2 km). */
export const COORD_GRID_DEG = 0.02;

/** A blocking "no history" verdict once this share of past hours has no data. */
export const MAX_MISSING_PAST_SHARE = 0.2;

/** Retention windows. */
export const SNAPSHOT_RETENTION_DAYS = 14;
export const FORECAST_RETENTION_DAYS = 30;
export const HISTORY_RETENTION_DAYS = 60;

export const FINGERPRINT_LOOKBACK_DAYS = 7;
/** A 'bale' reading this close to baled_at counts as measured at the bale. */
export const FINGERPRINT_READING_WINDOW_H = 2;

export const DEFAULT_METEO_SETTINGS: Omit<MeteoOrgSettings, 'organizationId'> = {
  enabled: false,
  enabledAt: null,
  thresholdWb: 0.15,
  baleableFracMin: 0.8,
  rainProbMax: 0.2,
  pressCapacityHaH: 3,
  minWindowH: 3,
  defaultMc0Wb: 0.3,
  activeDays: 21,
  updatedAt: null,
};

export interface RoundedCoord {
  key: string;
  lat: number;
  lon: number;
}

/** Round to the cache grid; the request uses the ROUNDED coordinate. */
export function roundCoord(lat: number, lon: number): RoundedCoord {
  const r = (x: number): number =>
    Number((Math.round(x / COORD_GRID_DEG) * COORD_GRID_DEG).toFixed(2));
  const rl = r(lat);
  const ro = r(lon);
  return { key: `${rl.toFixed(2)},${ro.toFixed(2)}`, lat: rl, lon: ro };
}

/**
 * Hourly arrays as stored in the JSONB columns. `time` is epoch ms (hour
 * label); every other key is an equally long array. Units: rh/pp fractions,
 * precip mm/h, wind m/s, rs W/m², t/td °C, sm07 m³/m³.
 */
export interface HourlyStore {
  time: number[];
  [field: string]: (number | null)[];
}

export const HOURLY_FIELDS = ['t2m', 'rh', 'td', 'wind', 'rs', 'precip', 'sm07'] as const;
