/**
 * Meteo module — baling-window forecast per parcel, field moisture readings and
 * the frozen per-bale-production weather fingerprint.
 *
 * Units (everywhere in this file and on the wire):
 *  - straw moisture is a WET-BASIS FRACTION (0.15 = 15 %) unless a field name
 *    says otherwise; the agro engine works in dry basis internally and converts
 *    at the edges (`@strawboss/domain` meteo/units).
 *  - relative humidity is a FRACTION (0..1), never percent.
 *  - precipitation is mm per hour; probabilities are fractions (0..1).
 *  - every timestamp is an ISO-8601 UTC string. Aggregated values labelled at
 *    hour t cover the interval (t−1h, t] (Open-Meteo convention).
 */

/** Traffic-light status of a parcel's baling window. */
export const MeteoStatusColor = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  grey: 'grey',
} as const;
export type MeteoStatusColor = (typeof MeteoStatusColor)[keyof typeof MeteoStatusColor];

export const SwathType = {
  narrow: 'narrow',
  wide: 'wide',
  turned: 'turned',
} as const;
export type SwathType = (typeof SwathType)[keyof typeof SwathType];

export const MoistureReadingKind = {
  /** Straw still lying in the swath — resets the drying model. */
  swath: 'swath',
  /** A finished bale — used only for the fingerprint and calibration. */
  bale: 'bale',
} as const;
export type MoistureReadingKind = (typeof MoistureReadingKind)[keyof typeof MoistureReadingKind];

export type HarvestEventCloseReason = 'baled' | 'expired' | 'manual';
export type FingerprintSourceStatus = 'ok' | 'modified' | 'deleted';
export type MeteoAccessLevel = 'ok' | 'marginal' | 'no_go' | 'unknown';

/** Fixed attribution line — must be visible wherever meteo data is shown. */
export const METEO_ATTRIBUTION = 'Date meteo: ECMWF, DWD (CC BY 4.0), prin Open-Meteo';

/** A reason behind a status, rendered by the UI from `meteo.reason.<key>`. */
export interface MeteoReason {
  key: string;
  params?: Record<string, string | number>;
}

/** One hour of the straw-moisture / weather series served to the UI. */
export interface MeteoHourPoint {
  time: string;
  /** Estimated straw moisture, wet basis — band across the forecast models. */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Fraction of models whose straw moisture is at/below the threshold. */
  baleableFrac: number | null;
  /** The hour passes every baling rule (moisture, dew, rain, access). */
  baleable: boolean;
  rainProb: number | null;
  /** Consensus precipitation, mm/h. */
  precipMm: number | null;
  dew: boolean;
  access: MeteoAccessLevel;
  /** Before the branch point: a single stitched past series, not a forecast. */
  observed: boolean;
  t2m: number | null;
  rh: number | null;
  windMs: number | null;
  /** Rain since the harvest (drying-clock start), mm. */
  rainCumMm?: number;
  /** Daylight drying hours since the harvest (no rain, no dew). */
  dryHoursCum?: number;
}

export interface MeteoWindow {
  start: string | null;
  end: string | null;
}

/** Status derived at READ time from the stored hourly series (never stored). */
export interface MeteoDerivedStatus {
  status: MeteoStatusColor;
  window: MeteoWindow;
  /** Hours of the next 48 h that are baleable / hours needed for the parcel. */
  coverage48h: number | null;
  requiredHours: number | null;
  urgency: number;
  reasons: MeteoReason[];
}

export interface MeteoStatus {
  /** OPEN_METEO_BASE_URL is set and allowed. */
  configured: boolean;
  /** Proof-of-concept mode: data comes from the public Open-Meteo API. */
  publicApi: boolean;
  /** Background jobs run on this deployment (METEO_JOBS_ENABLED). */
  jobsEnabled: boolean;
  /** The caller's organization opted in (meteo_org_settings.enabled). */
  enabled: boolean;
  lastIngestAt: string | null;
  attribution: string;
  modelVersion: string;
  /** Iteration 2 — optional so older clients ignore them. */
  forecastEnabled?: boolean;
  /** OPEN_METEO_ARCHIVE_BASE_URL is set and allowed (climatology). */
  climateConfigured?: boolean;
  climateEnabled?: boolean;
  /** Org has meteo.alerts on AND alerts_enabled in its settings. */
  alertsEnabled?: boolean;
}

export interface MeteoOrgSettings {
  organizationId: string;
  enabled: boolean;
  enabledAt: string | null;
  /** Wet-basis fraction, default 0.15 (large square bales). */
  thresholdWb: number;
  baleableFracMin: number;
  rainProbMax: number;
  pressCapacityHaH: number;
  minWindowH: number;
  defaultMc0Wb: number;
  activeDays: number;
  updatedAt: string | null;
}

export interface UpdateMeteoSettingsDto {
  enabled?: boolean;
  thresholdWb?: number;
  baleableFracMin?: number;
  rainProbMax?: number;
  pressCapacityHaH?: number;
  minWindowH?: number;
  defaultMc0Wb?: number;
  activeDays?: number;
}

export interface MeteoHarvestEvent {
  id: string;
  organizationId: string;
  parcelId: string;
  harvestedAt: string;
  harvestedAtBasis: 'manual' | 'audit_hint_confirmed';
  cropType: string | null;
  swathType: SwathType;
  closedAt: string | null;
  closeReason: HarvestEventCloseReason | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHarvestEventDto {
  parcelId: string;
  harvestedAt: string;
  swathType?: SwathType;
  /** true when the user accepted the date pre-filled from the status history. */
  fromAuditHint?: boolean;
}

export interface UpdateHarvestEventDto {
  harvestedAt?: string;
  swathType?: SwathType;
}

export interface MeteoMoistureReading {
  id: string;
  parcelId: string;
  harvestEventId: string | null;
  measuredAt: string;
  /** Wet-basis fraction. */
  moistureWb: number;
  kind: MoistureReadingKind;
  baleProductionId: string | null;
  lat: number | null;
  lon: number | null;
  source: 'web' | 'mobile';
  createdBy: string | null;
  createdAt: string;
}

export interface CreateMoistureReadingDto {
  /** Client-generated UUID — the endpoint is idempotent on it. */
  id: string;
  parcelId: string;
  measuredAt: string;
  /** PERCENT on the wire (e.g. 17.5) — converted to a fraction server-side. */
  moisturePct: number;
  kind: MoistureReadingKind;
  baleProductionId?: string | null;
  lat?: number | null;
  lon?: number | null;
  source: 'web' | 'mobile';
}

/** A parcel the dispatcher may want to start a drying clock for. */
export interface MeteoHarvestSuggestion {
  parcelId: string;
  parcelName: string | null;
  parcelCode: string | null;
  harvestStatus: string;
  cropType: string | null;
  /** First move to to_harvest/harvesting this season, from audit_logs — a HINT only. */
  hintAt: string | null;
}

export interface MeteoOverviewRow extends MeteoDerivedStatus {
  harvestEventId: string;
  parcelId: string;
  parcelName: string | null;
  parcelCode: string | null;
  cropType: string | null;
  areaHa: number | null;
  harvestedAt: string;
  swathType: SwathType;
  /** Current-hour estimate, wet basis. */
  mcP10: number | null;
  mcP50: number | null;
  mcP90: number | null;
  lastReadingAt: string | null;
  lastReadingWb: number | null;
  computedAt: string | null;
  /** Hours since the newest model run used — drives the "stale" grey. */
  dataAgeH: number | null;
  /** GeoJSON geometry of the parcel boundary (for the map). */
  boundary: unknown | null;
}

export interface MeteoOverview {
  rows: MeteoOverviewRow[];
  suggestions: MeteoHarvestSuggestion[];
  thresholdWb: number;
}

export interface MeteoParcelDetail {
  parcelId: string;
  parcelName: string | null;
  parcelCode: string | null;
  areaHa: number | null;
  event: MeteoHarvestEvent | null;
  derived: MeteoDerivedStatus | null;
  hours: MeteoHourPoint[];
  thresholdWb: number;
  models: string[];
  computedAt: string | null;
  dataAgeH: number | null;
  mc0Source: string | null;
  mc0At: string | null;
  modelVersion: string | null;
}

export interface MeteoBaleFingerprint {
  baleProductionId: string;
  parcelId: string;
  harvestEventId: string | null;
  baledAt: string;
  baledAtBasis: 'end_time' | 'start_time' | 'production_date_noon';
  windowStatus: MeteoStatusColor;
  runStatusAtCompute: MeteoStatusColor | null;
  rainSinceHarvestMm: number | null;
  dryingHours: number | null;
  mcP10: number | null;
  mcP50: number | null;
  mcP90: number | null;
  mcMeasured: number | null;
  modelVersion: string;
  attribution: string;
  sha256: string;
  frozenAt: string;
  /** Recomputed on read from the stored canonical text. */
  hashValid: boolean;
  /** Has the source bale_productions row changed/been deleted since freezing? */
  sourceStatus: FingerprintSourceStatus;
  baleCount: number | null;
  snapshotCanonical?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Iteration 2 — premium parcel weather, agro indicators, climatology, farm map,
// alerts. Same unit rules as above: fractions for percentages (rh, cloud cover,
// probabilities), m/s for wind, mm, °C, ISO-8601 timestamps; daily `date` is a
// local (Europe/Bucharest) YYYY-MM-DD.
// ─────────────────────────────────────────────────────────────────────────────

/** Icon key computed SERVER-side from the WMO weather code + day/night. */
export type MeteoWeatherIcon =
  | 'clear'
  | 'clear_night'
  | 'partly_cloudy'
  | 'partly_cloudy_night'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezing_drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'freezing_rain'
  | 'snow'
  | 'showers'
  | 'snow_showers'
  | 'thunderstorm'
  | 'thunderstorm_hail'
  | 'unknown';

export interface MeteoWeatherCurrent {
  time: string;
  tempC: number | null;
  apparentC: number | null;
  rh: number | null;
  precipMm: number | null;
  weatherCode: number | null;
  icon: MeteoWeatherIcon;
  cloudCover: number | null;
  windMs: number | null;
  gustMs: number | null;
  windDirDeg: number | null;
  isDay: boolean | null;
}

export interface MeteoWeatherHour {
  time: string;
  tempC: number | null;
  rh: number | null;
  dewPointC: number | null;
  precipMm: number | null;
  precipProb: number | null;
  weatherCode: number | null;
  icon: MeteoWeatherIcon;
  windMs: number | null;
  gustMs: number | null;
  windDirDeg: number | null;
  soilTemp0C: number | null;
  soilMoist0to1: number | null;
  soilMoist3to9: number | null;
  capeJkg: number | null;
  vpdKPa: number | null;
  leafWetProb: number | null;
  isDay: boolean | null;
  /** Spray conditions met this hour (null = not enough data to tell). */
  sprayOk: boolean | null;
}

export interface MeteoWeatherDay {
  date: string;
  weatherCode: number | null;
  icon: MeteoWeatherIcon;
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

export type MeteoRiskLevel = 'none' | 'low' | 'moderate' | 'high';

export interface MeteoSprayWindow {
  start: string;
  end: string;
  hours: number;
}

/** Reason keys are rendered by the UI from `meteo.agro.reason.<key>`. */
export interface MeteoAgroIndicators {
  spray: {
    windows: MeteoSprayWindow[];
    next: MeteoSprayWindow | null;
    nowOk: boolean | null;
    nowReasons: string[];
  };
  workability: {
    level: MeteoAccessLevel;
    soilMoist: number | null;
    rainPast48hMm: number | null;
    rainNext24hMm: number | null;
    reasons: string[];
  };
  frost: { level: MeteoRiskLevel; minAirC: number | null; minSoilC: number | null; at: string | null };
  heat: { level: MeteoRiskLevel; tMaxC: number | null; date: string | null };
  storm: { level: MeteoRiskLevel; maxCapeJkg: number | null; precipProb: number | null; at: string | null };
  waterBalance: {
    days: number;
    et0Mm: number | null;
    rainMm: number | null;
    balanceMm: number | null;
    deficit: boolean;
  };
}

export interface MeteoParcelWeather {
  parcelId: string;
  parcelName: string | null;
  parcelCode: string | null;
  cropType: string | null;
  /** null = the parcel has no geometry (no centroid, no boundary). */
  location: { lat: number; lon: number; cellKey: string } | null;
  fetchedAt: string | null;
  dailyFetchedAt: string | null;
  /** Served from a cache entry past its "fresh" age (upstream refresh failed/pending). */
  stale: boolean;
  publicApi: boolean;
  current: MeteoWeatherCurrent | null;
  /** Current hour .. +48 h. */
  hourly: MeteoWeatherHour[];
  /** 16 local days. */
  daily: MeteoWeatherDay[];
  agro: MeteoAgroIndicators | null;
  attribution: string;
}

/** Small payload for the mobile parcel card. */
export interface MeteoParcelWeatherCompact {
  parcelId: string;
  fetchedAt: string | null;
  stale: boolean;
  current: MeteoWeatherCurrent | null;
  attribution: string;
  next12h: Pick<MeteoWeatherHour, 'time' | 'tempC' | 'precipMm' | 'precipProb' | 'icon'>[];
  days: MeteoWeatherDay[];
  spray: MeteoSprayWindow | null;
  frost: MeteoRiskLevel;
  rain24hMm: number | null;
}

export interface MeteoParcelClimate {
  status: 'ready' | 'pending' | 'not_configured' | 'no_location';
  cellKey: string | null;
  period: string;
  monthlyNormals: { month: number; tmeanC: number; precipMm: number }[];
  monthToDate: {
    month: number;
    days: number;
    tmeanC: number | null;
    normalTmeanC: number | null;
    precipMm: number | null;
    normalPrecipMm: number | null;
    fullMonthNormalPrecipMm: number | null;
  } | null;
  last30: {
    from: string;
    to: string;
    tmeanC: number | null;
    normalTmeanC: number | null;
    anomalyC: number | null;
    precipMm: number | null;
    normalPrecipMm: number | null;
    precipPct: number | null;
    daysCovered: number;
  } | null;
  gdd: {
    cropType: string | null;
    baseC: number;
    start: string;
    to: string;
    basis: 'calendar_year';
    value: number | null;
    normal: number | null;
    anomalyPct: number | null;
    daysCovered: number;
  } | null;
  sourceNote: string;
}

export type MeteoFarmLayer = 'rain24h' | 'tempNow' | 'gust24h' | 'frost' | 'storm' | 'drying';

export interface MeteoFarmCell {
  key: string;
  lat: number;
  lon: number;
  icon: MeteoWeatherIcon;
  isDay: boolean | null;
  tempNowC: number | null;
  rain24hMm: number | null;
  rainProbMax24h: number | null;
  gustMax24hMs: number | null;
  tMin48hC: number | null;
  soilMin48hC: number | null;
  frost: MeteoRiskLevel;
  storm: MeteoRiskLevel;
  heat: MeteoRiskLevel;
}

export interface MeteoFarmParcel {
  parcelId: string;
  name: string | null;
  code: string | null;
  cropType: string | null;
  harvestStatus: string;
  cellKey: string;
  /** Simplified GeoJSON geometry, or null when only a centroid exists. */
  boundary: unknown | null;
  lat: number;
  lon: number;
}

export interface MeteoFarmWeather {
  fetchedAt: string | null;
  stale: boolean;
  cells: MeteoFarmCell[];
  parcels: MeteoFarmParcel[];
  /** Coverage cut by the parcel/cell caps (never silent). */
  dropped: { parcels: number; cells: number };
}

export type MeteoAlertType = 'frost' | 'storm' | 'wind' | 'heavy_rain' | 'heat';
export type MeteoAlertSeverity = 'warning' | 'severe';

export interface MeteoAlert {
  id: string;
  alertType: MeteoAlertType;
  severity: MeteoAlertSeverity;
  cellKey: string;
  localDay: string;
  startsAt: string;
  endsAt: string;
  peakAt: string;
  peakValue: number;
  threshold: number;
  parcelCount: number;
  parcels: { id: string; name: string | null; code: string | null }[];
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** A candidate produced by a dry-run evaluation (nothing written). */
export interface MeteoAlertCandidate {
  alertType: MeteoAlertType;
  severity: MeteoAlertSeverity;
  cellKey: string;
  localDay: string;
  startsAt: string;
  endsAt: string;
  peakAt: string;
  peakValue: number;
  threshold: number;
  parcelCount: number;
}

export interface MeteoAlertSettings {
  alertsEnabled: boolean;
  alertsEmail: boolean;
  frostC: number;
  heatC: number;
  gustMs: number;
  rainMm: number;
  capeJkg: number;
  lookaheadH: number;
}

export type UpdateMeteoAlertSettingsDto = Partial<MeteoAlertSettings>;
