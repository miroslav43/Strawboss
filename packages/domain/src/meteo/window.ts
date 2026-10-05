import type {
  MeteoDerivedStatus,
  MeteoHourPoint,
  MeteoReason,
  MeteoStatusColor,
} from '@strawboss/types';
import { HOUR_MS, floorHour, isoHour, round } from './units.js';

export interface BaleableRules {
  baleableFracMin: number;
  rainProbMax: number;
}

/** Hour passes every baling rule of design doc §3.5. */
export function isBaleableHour(pt: MeteoHourPoint, r: BaleableRules): boolean {
  return (
    pt.baleableFrac !== null &&
    pt.baleableFrac >= r.baleableFracMin &&
    !pt.dew &&
    (pt.rainProb === null || pt.rainProb < r.rainProbMax) &&
    pt.access !== 'no_go'
  );
}

export function markBaleableHours<T extends MeteoHourPoint>(points: readonly T[], r: BaleableRules): T[] {
  return points.map((pt) => ({ ...pt, baleable: isBaleableHour(pt, r) }));
}

/** Hours a press needs for the parcel; null when the area is unknown. */
export function requiredHoursFor(areaHa: number | null, pressCapacityHaH: number): number | null {
  if (areaHa === null || !Number.isFinite(areaHa) || areaHa <= 0) return null;
  if (!(pressCapacityHaH > 0)) return null;
  return Math.max(1, Math.ceil(areaHa / pressCapacityHaH));
}

export interface DeriveOptions extends BaleableRules {
  /** The instant the status is for: now (UI) or baled_at (fingerprint). */
  atMs: number;
  requiredHours: number | null;
  minWindowH: number;
  areaHa: number | null;
  computedAtMs: number | null;
  /** Initialisation time of the newest model run in the series. */
  newestIssuedAtMs: number | null;
  /** Engine-level blocker (e.g. missing history) → grey with this reason. */
  blockingReason?: MeteoReason | null;
  maxComputeAgeH?: number;
  maxRunAgeH?: number;
}

const grey = (reason: MeteoReason): MeteoDerivedStatus => ({
  status: 'grey',
  window: { start: null, end: null },
  coverage48h: null,
  requiredHours: null,
  urgency: 0,
  reasons: [reason],
});

/** Why is this hour not baleable? First matching rule wins. */
function blocker(pt: MeteoHourPoint, r: BaleableRules): string {
  if (pt.rainProb !== null && pt.rainProb >= r.rainProbMax) return 'rain';
  if (pt.dew) return 'dew';
  if (pt.access === 'no_go') return 'access';
  return 'moisture';
}

/**
 * The traffic light, computed at READ time for `atMs` (never stored):
 *  green  — baleable at `at`, and the current window is long enough
 *           (≥ min(required hours, minWindowH));
 *  yellow — some baleable hour within 48 h, but not green;
 *  red    — no baleable hour in the next 48 h;
 *  grey   — no data / no area / stale data / engine blocker.
 * Colour is separate from duration: a 40 ha parcel with two good days split by
 * dew is yellow-with-"not enough for the whole parcel", not red.
 */
export function deriveStatus(points: readonly MeteoHourPoint[], o: DeriveOptions): MeteoDerivedStatus {
  if (o.blockingReason) return grey(o.blockingReason);
  if (o.computedAtMs === null || points.length === 0) return grey({ key: 'noData' });
  const maxCompute = (o.maxComputeAgeH ?? 6) * HOUR_MS;
  const maxRun = (o.maxRunAgeH ?? 12) * HOUR_MS;
  if (o.atMs - o.computedAtMs > maxCompute) return grey({ key: 'staleData' });
  if (o.newestIssuedAtMs !== null && o.atMs - o.newestIssuedAtMs > maxRun) {
    return grey({ key: 'staleData' });
  }
  if (o.requiredHours === null) return grey({ key: 'noArea' });

  // The hour containing `at` is labelled by its END (Open-Meteo convention).
  const curLabel = floorHour(o.atMs) + (o.atMs % HOUR_MS === 0 ? 0 : HOUR_MS);
  const byTime = new Map(points.map((pt) => [Date.parse(pt.time), pt]));
  const horizon: MeteoHourPoint[] = [];
  for (let i = 0; i < 48; i++) {
    const pt = byTime.get(curLabel + i * HOUR_MS);
    if (!pt) break;
    horizon.push(pt);
  }
  if (horizon.length === 0 || horizon.every((pt) => pt.baleableFrac === null)) {
    return grey({ key: 'noData' });
  }

  const ok = horizon.map((pt) => isBaleableHour(pt, o));
  const baleableCount = ok.filter(Boolean).length;
  const coverage48h = round(baleableCount / o.requiredHours, 2);
  const need = Math.min(o.requiredHours, o.minWindowH);

  const runFrom = (i: number): number => {
    let j = i;
    while (j < ok.length && ok[j]) j++;
    return j - i;
  };
  // A window covers hours [startLabel−1h, endLabel]: it starts when its first
  // hour begins and ends at the label of its last hour.
  const windowOf = (i: number, len: number) => ({
    start: isoHour(Date.parse(horizon[i].time) - HOUR_MS),
    end: horizon[i + len - 1].time,
  });

  let status: MeteoStatusColor;
  let window: { start: string | null; end: string | null } = { start: null, end: null };
  const reasons: MeteoReason[] = [];

  if (ok[0]) {
    const len = runFrom(0);
    window = windowOf(0, len);
    if (len >= need) {
      status = 'green';
      reasons.push({ key: 'baleUntil', params: { until: window.end as string } });
    } else {
      status = 'yellow';
      reasons.push({ key: 'windowTooShort', params: { hours: len, need } });
    }
    if (len < horizon.length) {
      reasons.push({ key: `endsBy.${blocker(horizon[len], o)}`, params: { at: horizon[len - 1].time } });
    }
  } else if (baleableCount > 0) {
    status = 'yellow';
    const i = ok.indexOf(true);
    window = windowOf(i, runFrom(i));
    reasons.push({ key: 'baleableFrom', params: { from: window.start as string } });
    reasons.push({ key: `blockedNow.${blocker(horizon[0], o)}` });
  } else {
    status = 'red';
    reasons.push({ key: 'noWindow48h' });
    const counts = new Map<string, number>();
    horizon.forEach((pt) => counts.set(blocker(pt, o), (counts.get(blocker(pt, o)) ?? 0) + 1));
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    reasons.push({ key: `mainBlocker.${main}` });
  }
  if (status !== 'red' && coverage48h < 1) {
    reasons.push({ key: 'notEnoughForParcel', params: { have: baleableCount, need: o.requiredHours } });
  }

  return {
    status,
    window,
    coverage48h,
    requiredHours: o.requiredHours,
    urgency: status === 'green' || status === 'yellow' ? urgencyOf(horizon, ok, o.areaHa) : 0,
    reasons,
  };
}

/**
 * Risk of LOSING a window that exists: area × (share of baleable hours in the
 * next 24 h) × (worst rain probability 12–48 h out). Dry today + rain tomorrow
 * ranks first; wet all week and dry all week both rank low.
 */
export function urgencyOf(horizon: readonly MeteoHourPoint[], ok: readonly boolean[], areaHa: number | null): number {
  if (areaHa === null || !(areaHa > 0)) return 0;
  const first24 = ok.slice(0, 24);
  const pNow = first24.length ? first24.filter(Boolean).length / first24.length : 0;
  const later = horizon.slice(12, 48).map((pt) => pt.rainProb ?? 0);
  const pLoss = later.length ? Math.max(...later) : 0;
  return round(areaHa * pNow * pLoss, 3);
}

const STATUS_RANK: Record<MeteoStatusColor, number> = { green: 0, yellow: 1, red: 2, grey: 3 };

/** Overview order: green/yellow before red before grey, then by urgency. */
export function compareByStatusAndUrgency(
  a: { status: MeteoStatusColor; urgency: number },
  b: { status: MeteoStatusColor; urgency: number },
): number {
  const g = (s: MeteoStatusColor): number => (s === 'yellow' ? 0 : STATUS_RANK[s]);
  return g(a.status) - g(b.status) || b.urgency - a.urgency;
}
