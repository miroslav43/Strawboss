import type { MeteoHourPoint, SwathType } from '@strawboss/types';
import { accessLevel, rainFlags, isDewHour, tdFromRh, rhFromTd } from './derived.js';
import type { StrawParams } from './params.js';
import { simulate, type SimHour } from './straw-model.js';
import { HOUR_MS, dbToWb, floorHour, isoHour, quantile, round, wbToDb } from './units.js';

/** Raw weather for one hour, units per entities/meteo.ts (rh is a FRACTION). */
export interface WeatherHour {
  t2m: number | null;
  rh: number | null;
  td: number | null;
  windMs: number | null;
  rsWm2: number | null;
  precipMm: number | null;
  sm07: number | null;
}

export interface WeatherSeries {
  model: string;
  /** Native time step of the model in hours (1 = hourly). */
  stepH: number;
  /** Keyed by the hour LABEL in ms (the hour ending at that instant). */
  byTime: ReadonlyMap<number, WeatherHour>;
}

export interface EngineReading {
  measuredAtMs: number;
  moistureWb: number;
  kind: 'swath' | 'bale';
}

export interface EngineInput {
  harvestedAtMs: number;
  nowMs: number;
  /** Best-known single series for the past (stitched, primary model first). */
  past: WeatherSeries;
  /** One series per forecast model for the future. ≥ 1 required. */
  futures: readonly WeatherSeries[];
  /** ECMWF ensemble precipitation probability (fraction), keyed by hour label. */
  rainProb: ReadonlyMap<number, number> | null;
  readings: readonly EngineReading[];
  swathType: SwathType;
  thresholdWb: number;
  defaultMc0Wb: number;
  params: StrawParams;
  /** Future horizon cap in hours (default 7 days). */
  horizonH?: number;
}

/** MeteoHourPoint plus the cumulative fields the fingerprint needs. */
export interface EnginePoint extends MeteoHourPoint {
  rainCumMm: number;
  dryHoursCum: number;
}

export interface EngineResult {
  points: EnginePoint[];
  branchMs: number;
  pastHours: number;
  missingPastHours: number;
  models: string[];
  mc0Source: 'reading' | 'default';
  mc0AtMs: number;
  rainProbSource: 'ensemble' | 'models' | 'none';
}

const READING_CLUSTER_MS = 60 * 60_000;
const READING_LOOKBACK_MS = 12 * HOUR_MS;

/**
 * Swath readings become state resets: readings taken within 60 minutes of one
 * another form one sample (their MEDIAN — a single wild probe can't yank the
 * state), applied at the end of the hour of the cluster's last reading.
 */
export function buildResets(
  readings: readonly EngineReading[],
  harvestedAtMs: number,
  nowMs: number,
): Map<number, number> {
  const swath = readings
    .filter(
      (r) =>
        r.kind === 'swath' &&
        r.measuredAtMs >= harvestedAtMs - READING_LOOKBACK_MS &&
        r.measuredAtMs <= nowMs,
    )
    .sort((a, b) => a.measuredAtMs - b.measuredAtMs);
  const resets = new Map<number, number>();
  let cluster: EngineReading[] = [];
  const flush = (): void => {
    if (cluster.length === 0) return;
    const last = cluster[cluster.length - 1].measuredAtMs;
    const label = floorHour(last) + (last % HOUR_MS === 0 ? 0 : HOUR_MS);
    resets.set(label, wbToDb(quantile(cluster.map((r) => r.moistureWb), 0.5)));
    cluster = [];
  };
  for (const r of swath) {
    if (cluster.length > 0 && r.measuredAtMs - cluster[0].measuredAtMs > READING_CLUSTER_MS) flush();
    cluster.push(r);
  }
  flush();
  return resets;
}

/** Fill RH from dew point or dew point from RH, whichever is missing. */
function complete(w: WeatherHour | undefined): WeatherHour | null {
  if (!w) return null;
  let { rh, td } = w;
  if (w.t2m !== null) {
    if (rh === null && td !== null) rh = rhFromTd(w.t2m, td);
    if (td === null && rh !== null) td = tdFromRh(w.t2m, rh);
  }
  return { ...w, rh, td };
}

function toSimHour(w: WeatherHour | null, rain: boolean): SimHour {
  if (!w || w.t2m === null || w.rh === null) {
    return { t2m: null, rh: null, td: null, windMs: null, rsWm2: null, precipMm: w?.precipMm ?? null, rain, dew: false };
  }
  const td = w.td ?? tdFromRh(w.t2m, w.rh);
  return {
    t2m: w.t2m,
    rh: w.rh,
    td,
    windMs: w.windMs,
    rsWm2: w.rsWm2,
    precipMm: w.precipMm,
    rain,
    dew: isDewHour(w.t2m, td, w.windMs ?? 0, w.rsWm2 ?? 0),
  };
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The straw engine (design doc §3): one past simulation on the stitched series
 * from harvest to now (resetting at every reading cluster), then one forward
 * simulation per forecast model from the shared state at the branch hour. The
 * spread across models is the uncertainty band; with two models it is narrow
 * and the UI labels it "low confidence".
 */
export function runStrawEngine(input: EngineInput): EngineResult {
  const p = input.params;
  const swathFactor = p.swathFactor[input.swathType] ?? 1;
  const thrDb = wbToDb(input.thresholdWb);
  const branchMs = floorHour(input.nowMs);
  const startMs = floorHour(input.harvestedAtMs) + HOUR_MS;
  const horizonEnd = branchMs + (input.horizonH ?? 168) * HOUR_MS;

  let endMs = branchMs;
  for (const f of input.futures) {
    for (const t of f.byTime.keys()) if (t > endMs && t <= horizonEnd) endMs = t;
  }

  const resets = new Map<number, number>();
  for (const [label, db] of buildResets(input.readings, input.harvestedAtMs, input.nowMs)) {
    // A reading taken during the current hour is labelled with the hour that
    // has not ended yet — apply it at the branch so it is never dropped.
    resets.set(Math.min(label, branchMs), db);
  }
  let mc0Db = wbToDb(input.defaultMc0Wb);
  let mc0Source: EngineResult['mc0Source'] = 'default';
  let mc0AtMs = input.harvestedAtMs;
  for (const [label, db] of resets) {
    if (label < startMs) {
      mc0Db = db;
      mc0Source = 'reading';
      mc0AtMs = label;
    }
  }

  // ── past ────────────────────────────────────────────────────────────────
  const pastTimes: number[] = [];
  for (let t = startMs; t <= branchMs; t += HOUR_MS) pastTimes.push(t);
  const pastW = pastTimes.map((t) => complete(input.past.byTime.get(t)));
  const pastRain = rainFlags(
    pastTimes,
    pastW.map((w) => w?.precipMm ?? null),
    input.past.stepH,
    p.rainThresholdMm,
  );
  // In-window readings reset the state; mc0Source/mc0AtMs then report the
  // LATEST state anchor (the reading the current estimate descends from).
  const pastSim = pastTimes.map((t, i) => {
    const h = toSimHour(pastW[i], pastRain[i]);
    const r = resets.get(t);
    return { ...h, resetDb: r ?? null };
  });
  for (const t of pastTimes) {
    if (resets.has(t)) {
      mc0Source = 'reading';
      mc0AtMs = t;
    }
  }
  const pastSteps = simulate(mc0Db, pastSim, p, swathFactor);
  const missingPastHours = pastW.filter((w) => !w || w.t2m === null || w.rh === null).length;
  const branchDb = pastSteps.length > 0 ? pastSteps[pastSteps.length - 1].mcDb : mc0Db;

  // ── futures ─────────────────────────────────────────────────────────────
  const futTimes: number[] = [];
  for (let t = branchMs + HOUR_MS; t <= endMs; t += HOUR_MS) futTimes.push(t);
  const runs = input.futures.map((f) => {
    const w = futTimes.map((t) => complete(f.byTime.get(t)));
    const rain = rainFlags(futTimes, w.map((x) => x?.precipMm ?? null), f.stepH, p.rainThresholdMm);
    const sim = futTimes.map((_, i) => toSimHour(w[i], rain[i]));
    return { model: f.model, w, rain, sim, steps: simulate(branchDb, sim, p, swathFactor) };
  });

  // ── assemble ────────────────────────────────────────────────────────────
  const points: EnginePoint[] = [];
  const precipHistory: (number | null)[] = [];
  let rainCum = 0;
  let dryCum = 0;
  let rainProbSource: EngineResult['rainProbSource'] = 'none';
  const rain48 = (): number | null => {
    const win = precipHistory.slice(-48).filter((x): x is number => x !== null);
    return win.length === 0 ? null : win.reduce((a, b) => a + b, 0);
  };
  const push = (pt: Omit<EnginePoint, 'access' | 'rainCumMm' | 'dryHoursCum'>, sm07: number | null, dryHour: boolean): void => {
    precipHistory.push(pt.precipMm);
    rainCum += pt.precipMm ?? 0;
    if (dryHour) dryCum += 1;
    points.push({
      ...pt,
      access: accessLevel(sm07, rain48(), p.access),
      rainCumMm: round(rainCum, 2),
      dryHoursCum: dryCum,
    });
  };

  pastTimes.forEach((t, i) => {
    const w = pastW[i];
    const s = pastSteps[i];
    const sh = pastSim[i];
    const wb = round(dbToWb(s.mcDb), 4);
    const ensemble = input.rainProb?.get(t);
    push(
      {
        time: isoHour(t),
        p10: wb,
        p50: wb,
        p90: wb,
        baleableFrac: s.mcDb <= thrDb ? 1 : 0,
        baleable: false,
        rainProb: ensemble ?? (pastRain[i] ? 1 : 0),
        precipMm: w?.precipMm ?? null,
        dew: sh.dew,
        observed: true,
        t2m: w?.t2m ?? null,
        rh: w?.rh ?? null,
        windMs: w?.windMs ?? null,
      },
      w?.sm07 ?? null,
      !pastRain[i] && !sh.dew && (w?.rsWm2 ?? 0) >= 50,
    );
  });

  futTimes.forEach((t, i) => {
    const live = runs.filter((r) => r.w[i] && r.w[i]!.t2m !== null && r.w[i]!.rh !== null);
    const mcs = live.map((r) => r.steps[i].mcDb);
    const precs = runs.map((r) => r.w[i]?.precipMm).filter((x): x is number => x !== null && x !== undefined);
    const ensemble = input.rainProb?.get(t);
    let rainProb: number | null = null;
    if (ensemble !== undefined) {
      rainProb = ensemble;
      rainProbSource = 'ensemble';
    } else if (runs.length > 0) {
      rainProb = runs.filter((r) => r.rain[i]).length / runs.length;
      if (rainProbSource === 'none') rainProbSource = 'models';
    }
    const dewVotes = live.filter((r) => r.sim[i].dew).length;
    const dew = live.length > 0 && dewVotes / live.length >= 0.5;
    const rainVotes = runs.filter((r) => r.rain[i]).length;
    const rs = mean(live.map((r) => r.w[i]!.rsWm2).filter((x): x is number => x !== null));
    const sm = mean(runs.map((r) => r.w[i]?.sm07).filter((x): x is number => x !== null && x !== undefined));
    push(
      {
        time: isoHour(t),
        p10: mcs.length ? round(dbToWb(quantile(mcs, 0.1)), 4) : null,
        p50: mcs.length ? round(dbToWb(quantile(mcs, 0.5)), 4) : null,
        p90: mcs.length ? round(dbToWb(quantile(mcs, 0.9)), 4) : null,
        baleableFrac: mcs.length ? mcs.filter((m) => m <= thrDb).length / mcs.length : null,
        baleable: false,
        rainProb,
        precipMm: mean(precs),
        dew,
        observed: false,
        t2m: mean(live.map((r) => r.w[i]!.t2m as number)),
        rh: mean(live.map((r) => r.w[i]!.rh as number)),
        windMs: mean(live.map((r) => r.w[i]!.windMs).filter((x): x is number => x !== null)),
      },
      sm,
      rainVotes * 2 < Math.max(runs.length, 1) && !dew && (rs ?? 0) >= 50,
    );
  });

  return {
    points,
    branchMs,
    pastHours: pastTimes.length,
    missingPastHours,
    models: input.futures.map((f) => f.model),
    mc0Source,
    mc0AtMs,
    rainProbSource,
  };
}
