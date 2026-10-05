import type {
  MeteoDerivedStatus,
  MeteoHourPoint,
  MeteoStatusColor,
  SwathType,
} from '@strawboss/types';
import { HOUR_MS, floorHour } from './units.js';

/**
 * Deterministic JSON: object keys sorted, `undefined` object members dropped.
 * Accepts ONLY plain JSON values — a Date, bigint, NaN/Infinity, function or
 * an `undefined` array slot throws, so a caller can never hash something whose
 * serialisation depends on the runtime. The fingerprint stores this exact text
 * and re-verification hashes the stored text (never a rebuilt object).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number in canonical JSON: ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((v) => {
            if (v === undefined) throw new TypeError('undefined array element in canonical JSON');
            return canonicalJson(v);
          })
          .join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`non-plain object in canonical JSON: ${proto?.constructor?.name ?? 'unknown'}`);
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`unsupported type in canonical JSON: ${typeof value}`);
  }
}

export type BaledAtBasis = 'end_time' | 'start_time' | 'production_date_noon';

/** Snapshot point as stored: MeteoHourPoint + the engine's cumulative fields. */
export type SnapshotPoint = MeteoHourPoint & { rainCumMm?: number; dryHoursCum?: number };

export interface FingerprintInput {
  baleProduction: {
    id: string;
    parcelId: string;
    baleCount: number;
    productionDate: string;
    startTime: string | null;
    endTime: string | null;
  };
  baledAt: string;
  baledAtBasis: BaledAtBasis;
  harvestEvent: { id: string; harvestedAt: string; swathType: SwathType } | null;
  snapshot: {
    id: string;
    computedAt: string;
    modelVersion: string;
    models: string[];
    points: readonly SnapshotPoint[];
  } | null;
  settings: {
    thresholdWb: number;
    baleableFracMin: number;
    rainProbMax: number;
    minWindowH: number;
    pressCapacityHaH: number;
  };
  /** Status evaluated at baled_at on the snapshot (deriveStatus with atMs = baled_at). */
  derived: MeteoDerivedStatus;
  runStatusAtCompute: MeteoStatusColor | null;
  measured: { readingId: string; moistureWb: number; measuredAt: string } | null;
  attribution: string;
}

export interface FingerprintBuild {
  payload: Record<string, unknown>;
  windowStatus: MeteoStatusColor;
  mcP10: number | null;
  mcP50: number | null;
  mcP90: number | null;
  mcMeasured: number | null;
  rainSinceHarvestMm: number | null;
  dryingHours: number | null;
}

/**
 * The frozen per-bale-production weather record (design doc §5.1): what we
 * knew when the bales were made. Built ONCE; never recomputed when the model
 * improves.
 */
export function buildFingerprint(input: FingerprintInput): FingerprintBuild {
  const baledMs = Date.parse(input.baledAt);
  const label = floorHour(baledMs) + (baledMs % HOUR_MS === 0 ? 0 : HOUR_MS);
  const points = input.snapshot?.points ?? [];
  const at = points.find((pt) => Date.parse(pt.time) === label) ?? null;
  const harvestMs = input.harvestEvent ? Date.parse(input.harvestEvent.harvestedAt) : null;
  const series = points.filter((pt) => {
    const t = Date.parse(pt.time);
    return t <= label && (harvestMs === null || t > harvestMs);
  });

  const build: FingerprintBuild = {
    payload: {},
    windowStatus: input.derived.status,
    mcP10: at?.p10 ?? null,
    mcP50: at?.p50 ?? null,
    mcP90: at?.p90 ?? null,
    mcMeasured: input.measured?.moistureWb ?? null,
    rainSinceHarvestMm: at?.rainCumMm ?? null,
    dryingHours: at?.dryHoursCum ?? null,
  };
  build.payload = {
    v: 'fp-v1',
    attribution: input.attribution,
    baleProduction: input.baleProduction,
    baledAt: input.baledAt,
    baledAtBasis: input.baledAtBasis,
    harvestEvent: input.harvestEvent,
    snapshot: input.snapshot
      ? {
          id: input.snapshot.id,
          computedAt: input.snapshot.computedAt,
          modelVersion: input.snapshot.modelVersion,
          models: input.snapshot.models,
        }
      : null,
    settings: input.settings,
    windowStatus: build.windowStatus,
    runStatusAtCompute: input.runStatusAtCompute,
    reasons: input.derived.reasons,
    mcAtBale: { p10: build.mcP10, p50: build.mcP50, p90: build.mcP90 },
    mcMeasured: input.measured,
    rainSinceHarvestMm: build.rainSinceHarvestMm,
    dryingHours: build.dryingHours,
    series: series.map((pt) => ({
      time: pt.time,
      p10: pt.p10,
      p50: pt.p50,
      p90: pt.p90,
      baleable: pt.baleable,
      rainProb: pt.rainProb,
      precipMm: pt.precipMm,
      dew: pt.dew,
      observed: pt.observed,
      t2m: pt.t2m,
      rh: pt.rh,
      windMs: pt.windMs,
    })),
  };
  return build;
}
