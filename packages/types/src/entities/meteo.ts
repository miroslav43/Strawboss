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
