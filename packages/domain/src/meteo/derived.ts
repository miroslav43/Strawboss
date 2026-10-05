import type { MeteoAccessLevel } from '@strawboss/types';
import type { StrawParams } from './params.js';

/** Saturation vapour pressure (kPa), Tetens/FAO-56 form, T in °C. */
export function satVapKPa(t: number): number {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/** Vapour-pressure deficit (kPa) from air temperature and dew point (°C). */
export function vpdKPa(t: number, td: number): number {
  return Math.max(0, satVapKPa(t) - satVapKPa(td));
}

/** Relative humidity FRACTION from temperature and dew point. */
export function rhFromTd(t: number, td: number): number {
  return Math.min(1, Math.max(0, satVapKPa(td) / satVapKPa(t)));
}

/** Dew point (°C) from temperature and RH fraction — inverse Magnus. */
export function tdFromRh(t: number, rh: number): number {
  assertFraction(rh);
  const g = Math.log(Math.max(rh, 1e-6)) + (17.27 * t) / (t + 237.3);
  return (237.3 * g) / (17.27 - g);
}

export function assertFraction(rh: number): void {
  if (!(rh >= 0 && rh <= 1)) {
    throw new RangeError(`relative humidity must be a fraction 0..1, got ${rh}`);
  }
}

/**
 * Night/early-morning re-wetting: air near saturation, still, and dark.
 * Thresholds are starting values from the design doc §2.4.
 */
export function isDewHour(t: number, td: number, windMs: number, rsWm2: number): boolean {
  return t - td < 2 && windMs < 2 && rsWm2 < 50;
}

/**
 * Rain flags for a series that may come from a model with a coarse native step
 * (`stepH` > 1) which Open-Meteo spreads evenly over the hours: the threshold is
 * applied to the SUM over each native block, not to the smeared hourly value
 * (0.5 mm in 3 h would otherwise read as 0.17 mm/h — "no rain").
 *
 * `timesMs[i]` labels the hour ending at that instant (Open-Meteo convention),
 * so a block ends on a UTC hour that is a multiple of `stepH`.
 */
export function rainFlags(
  timesMs: readonly number[],
  precip: readonly (number | null)[],
  stepH: number,
  thresholdMm: number,
): boolean[] {
  if (stepH <= 1) return precip.map((p) => p !== null && p > thresholdMm);
  const blockOf = (ms: number): number => Math.ceil(ms / 3_600_000 / stepH);
  const sums = new Map<number, number>();
  timesMs.forEach((ms, i) => {
    const b = blockOf(ms);
    sums.set(b, (sums.get(b) ?? 0) + (precip[i] ?? 0));
  });
  return timesMs.map((ms) => (sums.get(blockOf(ms)) ?? 0) > thresholdMm * stepH);
}

export function accessLevel(
  sm07: number | null,
  rain48hMm: number | null,
  p: StrawParams['access'],
): MeteoAccessLevel {
  if (sm07 === null && rain48hMm === null) return 'unknown';
  if ((sm07 ?? 0) >= p.sm07NoGo || (rain48hMm ?? 0) >= p.rain48hNoGoMm) return 'no_go';
  if ((sm07 ?? 0) >= p.sm07Marginal || (rain48hMm ?? 0) >= p.rain48hMarginalMm) return 'marginal';
  return 'ok';
}
