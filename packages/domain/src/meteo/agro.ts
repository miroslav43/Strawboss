import type { MeteoAccessLevel, MeteoRiskLevel } from '@strawboss/types';
import { accessLevel } from './derived.js';
import { STRAW_PARAMS_V1, type StrawParams } from './params.js';
import { HOUR_MS, floorHour, round } from './units.js';

/**
 * Agronomic indicators computed from the forecast (no extra data cost). Every
 * threshold is a named starting value — agronomic practice, not calibration.
 */

/** One forecast hour; every field may be null when a model lacks it. */
export interface AgroHour {
  timeMs: number;
  tempC: number | null;
  dewPointC: number | null;
  precipMm: number | null;
  /** Fraction 0..1. */
  precipProb: number | null;
  windMs: number | null;
  gustMs: number | null;
  /** Fraction 0..1. */
  leafWetProb: number | null;
  soilTemp0C: number | null;
  soilMoist0to1: number | null;
  soilMoist3to9: number | null;
  capeJkg: number | null;
  isDay: boolean | null;
}

/** Plant-protection spraying: drift, wash-off and efficacy limits. */
export const SPRAY_THRESHOLDS = {
  windMaxMs: 4,
  gustMaxMs: 7,
  /** Dead calm favours inversions and drift of fine droplets. */
  windMinMs: 0.5,
  tempMinC: 8,
  tempMaxC: 25,
  rainNowMm: 0.1,
  rainSoonMm: 0.2,
  rainSoonProbMax: 0.2,
  rainLookaheadH: 6,
  leafWetMax: 0.5,
  dewSpreadC: 1.5,
  minWindowH: 2,
} as const;

export const FROST = { airC: 0, soilC: 0, watchAirC: 2 } as const;
export const HEAT = { warningC: 32, severeC: 35 } as const;
export const STORM = { capeModerate: 1000, capeHigh: 2000, probMin: 0.4 } as const;
export const WATER = { days: 7, deficitMm: -15 } as const;

export type SprayReason =
  | 'wind'
  | 'gust'
  | 'calm'
  | 'rain_now'
  | 'rain_soon'
  | 'too_cold'
  | 'too_hot'
  | 'leaf_wet'
  | 'no_data';

type SprayThresholds = { [K in keyof typeof SPRAY_THRESHOLDS]: number };

/**
 * Is hour `i` good for spraying? `ok` is null when a needed value is missing or
 * the series does not reach `rainLookaheadH` hours ahead (rain wash-off cannot
 * be ruled out).
 */
export function sprayHour(
  hours: readonly AgroHour[],
  i: number,
  t: SprayThresholds = SPRAY_THRESHOLDS,
): { ok: boolean | null; reasons: SprayReason[] } {
  const h = hours[i];
  if (!h || h.tempC === null || h.windMs === null || h.gustMs === null || h.precipMm === null) {
    return { ok: null, reasons: ['no_data'] };
  }
  const ahead = hours.slice(i + 1, i + 1 + t.rainLookaheadH);
  if (ahead.length < t.rainLookaheadH) return { ok: null, reasons: ['no_data'] };

  const reasons: SprayReason[] = [];
  if (h.windMs > t.windMaxMs) reasons.push('wind');
  if (h.gustMs > t.gustMaxMs) reasons.push('gust');
  if (h.windMs < t.windMinMs) reasons.push('calm');
  if (h.precipMm > t.rainNowMm) reasons.push('rain_now');
  if (
    ahead.some(
      (a) =>
        (a.precipMm !== null && a.precipMm > t.rainSoonMm) ||
        (a.precipProb !== null && a.precipProb > t.rainSoonProbMax),
    )
  ) {
    reasons.push('rain_soon');
  }
  if (h.tempC < t.tempMinC) reasons.push('too_cold');
  if (h.tempC > t.tempMaxC) reasons.push('too_hot');
  if (
    (h.leafWetProb !== null && h.leafWetProb > t.leafWetMax) ||
    (h.dewPointC !== null && h.tempC - h.dewPointC < t.dewSpreadC)
  ) {
    reasons.push('leaf_wet');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Contiguous runs of good spray hours starting at/after the current hour, at
 * least `minWindowH` long. A window covers [first hour, last hour + 1 h).
 */
export function sprayWindows(
  hours: readonly AgroHour[],
  nowMs: number,
  t: SprayThresholds = SPRAY_THRESHOLDS,
): { startMs: number; endMs: number; hours: number }[] {
  const from = floorHour(nowMs);
  const out: { startMs: number; endMs: number; hours: number }[] = [];
  let runStart = -1;
  const close = (endIdx: number): void => {
    if (runStart < 0) return;
    const len = endIdx - runStart;
    if (len >= t.minWindowH) {
      out.push({ startMs: hours[runStart].timeMs, endMs: hours[endIdx - 1].timeMs + HOUR_MS, hours: len });
    }
    runStart = -1;
  };
  for (let i = 0; i < hours.length; i++) {
    if (hours[i].timeMs < from) continue;
    const ok = sprayHour(hours, i, t).ok === true;
    if (ok && runStart < 0) runStart = i;
    if (!ok) close(i);
  }
  close(hours.length);
  return out;
}

/**
 * Can machines go on the field? Soil moisture (mean of the available top
 * layers) + rain of the last 48 h, as for the drying model's access level, and
 * heavy rain in the next 24 h downgrades "ok" to "marginal".
 */
export function fieldWorkability(
  i: {
    soilMoist0to1: number | null;
    soilMoist3to9: number | null;
    rainPast48hMm: number | null;
    rainNext24hMm: number | null;
  },
  p: StrawParams['access'] = STRAW_PARAMS_V1.access,
): { level: MeteoAccessLevel; soilMoist: number | null; reasons: string[] } {
  const layers = [i.soilMoist0to1, i.soilMoist3to9].filter((x): x is number => x !== null);
  const soilMoist = layers.length ? round(layers.reduce((a, b) => a + b, 0) / layers.length, 3) : null;
  let level = accessLevel(soilMoist, i.rainPast48hMm, p);
  const reasons: string[] = [];
  if (level === 'no_go' || level === 'marginal') {
    const wetLimit = level === 'no_go' ? p.sm07NoGo : p.sm07Marginal;
    const rainLimit = level === 'no_go' ? p.rain48hNoGoMm : p.rain48hMarginalMm;
    if (soilMoist !== null && soilMoist >= wetLimit) reasons.push('soil_wet');
    if (i.rainPast48hMm !== null && i.rainPast48hMm >= rainLimit) reasons.push('rain_recent');
  }
  if (level === 'ok' && i.rainNext24hMm !== null && i.rainNext24hMm >= p.rain48hMarginalMm) {
    level = 'marginal';
    reasons.push('rain_coming');
  }
  return { level, soilMoist, reasons };
}

const inWindow = (hours: readonly AgroHour[], nowMs: number, horizonH: number): AgroHour[] => {
  const from = floorHour(nowMs);
  const to = nowMs + horizonH * HOUR_MS;
  return hours.filter((h) => h.timeMs >= from && h.timeMs <= to);
};

export function frostRisk(
  hours: readonly AgroHour[],
  nowMs: number,
  horizonH = 48,
  f: { airC: number; soilC: number; watchAirC: number } = FROST,
): { level: MeteoRiskLevel; minAirC: number | null; minSoilC: number | null; atMs: number | null } {
  let minAir: AgroHour | null = null;
  let minSoil: AgroHour | null = null;
  for (const h of inWindow(hours, nowMs, horizonH)) {
    if (h.tempC !== null && (minAir === null || h.tempC < (minAir.tempC as number))) minAir = h;
    if (h.soilTemp0C !== null && (minSoil === null || h.soilTemp0C < (minSoil.soilTemp0C as number))) minSoil = h;
  }
  const minAirC = minAir?.tempC ?? null;
  const minSoilC = minSoil?.soilTemp0C ?? null;
  let level: MeteoRiskLevel = 'none';
  let atMs: number | null = null;
  if ((minAirC !== null && minAirC <= f.airC) || (minSoilC !== null && minSoilC <= f.soilC)) {
    level = 'high';
    atMs = minAirC !== null && minAirC <= f.airC ? minAir!.timeMs : minSoil!.timeMs;
  } else if (minAirC !== null && minAirC <= f.watchAirC) {
    level = 'low';
    atMs = minAir!.timeMs;
  }
  return { level, minAirC, minSoilC, atMs };
}

export function heatStress(
  days: readonly { date: string; tMaxC: number | null }[],
  n = 3,
  h: { warningC: number; severeC: number } = HEAT,
): { level: MeteoRiskLevel; tMaxC: number | null; date: string | null } {
  let best: { date: string; tMaxC: number } | null = null;
  for (const d of days.slice(0, n)) {
    if (d.tMaxC !== null && (best === null || d.tMaxC > best.tMaxC)) best = { date: d.date, tMaxC: d.tMaxC };
  }
  if (!best) return { level: 'none', tMaxC: null, date: null };
  const level: MeteoRiskLevel = best.tMaxC >= h.severeC ? 'high' : best.tMaxC >= h.warningC ? 'moderate' : 'none';
  return { level, tMaxC: best.tMaxC, date: best.date };
}

/**
 * Convective storm / hail risk: instability (CAPE) that actually meets
 * precipitation. High CAPE in a dry forecast stays "none".
 */
export function stormRisk(
  hours: readonly AgroHour[],
  nowMs: number,
  horizonH = 48,
  s: { capeModerate: number; capeHigh: number; probMin: number } = STORM,
): { level: MeteoRiskLevel; maxCapeJkg: number | null; precipProb: number | null; atMs: number | null } {
  let level: MeteoRiskLevel = 'none';
  let maxCape: number | null = null;
  let trigger: AgroHour | null = null;
  for (const h of inWindow(hours, nowMs, horizonH)) {
    if (h.capeJkg !== null && (maxCape === null || h.capeJkg > maxCape)) maxCape = h.capeJkg;
    if (h.capeJkg === null || h.precipProb === null || h.precipProb < s.probMin) continue;
    const l: MeteoRiskLevel = h.capeJkg >= s.capeHigh ? 'high' : h.capeJkg >= s.capeModerate ? 'moderate' : 'none';
    if (l === 'high' && level !== 'high') {
      level = 'high';
      trigger = h;
    } else if (l === 'moderate' && level === 'none') {
      level = 'moderate';
      trigger = h;
    }
  }
  return { level, maxCapeJkg: maxCape, precipProb: trigger?.precipProb ?? null, atMs: trigger?.timeMs ?? null };
}

/** Reference evapotranspiration vs rain over the next `n` days. */
export function waterBalance(
  days: readonly { et0Mm: number | null; precipMm: number | null }[],
  n: number = WATER.days,
  deficitMm: number = WATER.deficitMm,
): { days: number; et0Mm: number | null; rainMm: number | null; balanceMm: number | null; deficit: boolean } {
  const slice = days.slice(0, n);
  const et0 = slice.map((d) => d.et0Mm).filter((x): x is number => x !== null);
  const rain = slice.map((d) => d.precipMm).filter((x): x is number => x !== null);
  const et0Mm = et0.length ? round(et0.reduce((a, b) => a + b, 0), 1) : null;
  const rainMm = rain.length ? round(rain.reduce((a, b) => a + b, 0), 1) : null;
  const balanceMm = et0Mm !== null && rainMm !== null ? round(rainMm - et0Mm, 1) : null;
  return { days: slice.length, et0Mm, rainMm, balanceMm, deficit: balanceMm !== null && balanceMm <= deficitMm };
}
