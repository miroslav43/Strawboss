import { round } from './units.js';

/**
 * Climatology helpers: 1991–2020 day-of-year normals from ERA5 daily data and
 * growing degree days. Pure — the backend fetches, these compute.
 */

/** GDD base temperature per crop_type (°C). Cereals use 0 °C, the rest 5 °C. */
export const GDD_BASE_C: Readonly<Record<string, number>> = {
  grau: 0,
  orz: 0,
  rapita: 5,
  plante_nutret: 5,
  altele: 5,
};
export const GDD_DEFAULT_BASE_C = 5;

export function gddBaseFor(cropType: string | null | undefined): number {
  if (!cropType) return GDD_DEFAULT_BASE_C;
  return GDD_BASE_C[cropType] ?? GDD_DEFAULT_BASE_C;
}

export function gddDay(tmeanC: number, baseC: number): number {
  return Math.max(0, tmeanC - baseC);
}

// Cumulative day offsets of a LEAP year: every date maps to the same index in
// every year (Mar 1 = 60 always; Feb 29 = 59 exists only in leap years).
const LEAP_OFFSETS = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/** 'YYYY-MM-DD' → 0..365 on a fixed leap-year calendar. */
export function doyIndex(date: string): number {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new RangeError(`bad date: ${date}`);
  return LEAP_OFFSETS[m - 1] + d - 1;
}

export interface ClimateNormals {
  /** 366 values, index = doyIndex(). */
  doyTmean: number[];
  doyPrecip: number[];
  doyGdd0: number[];
  doyGdd5: number[];
  monthly: { month: number; tmeanC: number; precipMm: number }[];
  years: number;
}

const FEB29 = 59;

/**
 * Day-of-year means over the input years. Feb 29 is averaged over leap years
 * only; if the input has none, it is the mean of Feb 28 and Mar 1. Monthly
 * precipitation is the mean monthly TOTAL (sum ÷ years present for that month).
 */
export function buildClimateNormals(
  days: readonly { date: string; tmeanC: number | null; precipMm: number | null }[],
): ClimateNormals {
  const n = 366;
  const acc = {
    t: new Array<number>(n).fill(0),
    tc: new Array<number>(n).fill(0),
    p: new Array<number>(n).fill(0),
    pc: new Array<number>(n).fill(0),
    g0: new Array<number>(n).fill(0),
    g5: new Array<number>(n).fill(0),
  };
  const monthT = new Array<number>(12).fill(0);
  const monthTc = new Array<number>(12).fill(0);
  const monthP = new Array<number>(12).fill(0);
  const monthYears: Set<string>[] = Array.from({ length: 12 }, () => new Set<string>());
  const years = new Set<string>();

  for (const d of days) {
    const i = doyIndex(d.date);
    const m = Number(d.date.slice(5, 7)) - 1;
    years.add(d.date.slice(0, 4));
    if (d.tmeanC !== null && Number.isFinite(d.tmeanC)) {
      acc.t[i] += d.tmeanC;
      acc.tc[i] += 1;
      acc.g0[i] += gddDay(d.tmeanC, 0);
      acc.g5[i] += gddDay(d.tmeanC, 5);
      monthT[m] += d.tmeanC;
      monthTc[m] += 1;
    }
    if (d.precipMm !== null && Number.isFinite(d.precipMm)) {
      acc.p[i] += d.precipMm;
      acc.pc[i] += 1;
      monthP[m] += d.precipMm;
      monthYears[m].add(d.date.slice(0, 4));
    }
  }
  const mean = (sum: number[], cnt: number[]): number[] =>
    sum.map((s, i) => (cnt[i] > 0 ? round(s / cnt[i], 3) : NaN));
  const doyTmean = mean(acc.t, acc.tc);
  const doyPrecip = mean(acc.p, acc.pc);
  const doyGdd0 = mean(acc.g0, acc.tc);
  const doyGdd5 = mean(acc.g5, acc.tc);
  for (const arr of [doyTmean, doyPrecip, doyGdd0, doyGdd5]) {
    if (Number.isNaN(arr[FEB29])) arr[FEB29] = round((arr[FEB29 - 1] + arr[FEB29 + 1]) / 2, 3);
    for (let i = 0; i < n; i++) if (Number.isNaN(arr[i])) arr[i] = 0;
  }
  const monthly = monthT.map((s, m) => ({
    month: m + 1,
    tmeanC: monthTc[m] > 0 ? round(s / monthTc[m], 2) : 0,
    precipMm: monthYears[m].size > 0 ? round(monthP[m] / monthYears[m].size, 1) : 0,
  }));
  return { doyTmean, doyPrecip, doyGdd0, doyGdd5, monthly, years: years.size };
}

const DAY_MS = 86_400_000;

/** Calendar dates from..to inclusive ('YYYY-MM-DD'), real calendar (no Feb 29 in non-leap years). */
export function datesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  for (let t = from; t <= to; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Sum of a doy-normal array over a real date range (e.g. normal GDD Jan 1 → yesterday). */
export function sumNormal(arr: readonly number[], fromDate: string, toDate: string): number {
  return round(
    datesBetween(fromDate, toDate).reduce((s, d) => s + (arr[doyIndex(d)] ?? 0), 0),
    2,
  );
}

export function meanNormal(arr: readonly number[], fromDate: string, toDate: string): number | null {
  const ds = datesBetween(fromDate, toDate);
  return ds.length ? round(ds.reduce((s, d) => s + (arr[doyIndex(d)] ?? 0), 0) / ds.length, 2) : null;
}

export function climateAnomaly(i: {
  actualTmean: number | null;
  normalTmean: number | null;
  actualPrecip: number | null;
  normalPrecip: number | null;
}): { anomalyC: number | null; precipPct: number | null } {
  const anomalyC =
    i.actualTmean !== null && i.normalTmean !== null ? round(i.actualTmean - i.normalTmean, 1) : null;
  const precipPct =
    i.actualPrecip !== null && i.normalPrecip !== null && i.normalPrecip >= 1
      ? Math.round((i.actualPrecip / i.normalPrecip) * 100)
      : null;
  return { anomalyC, precipPct };
}
