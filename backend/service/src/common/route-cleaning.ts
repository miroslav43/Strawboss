import { ACCURACY_CAP_M, GAP_SPLIT_S, SEGMENT_CAP_M, SPEED_CAP_MS } from './gps-noise';

/** Earth mean radius in metres, matching PostGIS `ST_DistanceSphere`. */
const EARTH_RADIUS_M = 6371008;

/** Great-circle distance in metres between two WGS84 points. */
function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Minimum shape a point needs for cleaning. Extra fields are carried through. */
interface CleanablePoint {
  lat: number;
  lon: number;
  accuracyM: number | null;
  recordedAt: string;
}

export interface RouteCleanOptions {
  maxAccuracyM: number;
  maxSpeedMs: number;
  maxLegM: number;
  gapS: number;
  /**
   * After this many points in a row fail against the current anchor, conclude
   * that the ANCHOR was the outlier rather than all of them, and re-anchor.
   */
  maxConsecutiveRejects: number;
}

/** A contiguous run of points with no outage between them. Both ends inclusive. */
export interface RouteSegment {
  startIndex: number;
  endIndex: number;
}

export interface RouteCleanStats {
  rawPoints: number;
  keptPoints: number;
  droppedLowAccuracy: number;
  droppedOutlier: number;
  droppedBadTimestamp: number;
  segmentCount: number;
}

export interface RouteCleanResult<T> {
  points: T[];
  segments: RouteSegment[];
  stats: RouteCleanStats;
}

const DEFAULTS: RouteCleanOptions = {
  maxAccuracyM: ACCURACY_CAP_M,
  maxSpeedMs: SPEED_CAP_MS,
  maxLegM: SEGMENT_CAP_M,
  gapS: GAP_SPLIT_S,
  maxConsecutiveRejects: 3,
};

/**
 * Turn a raw, chronologically-ordered GPS ping list into a drawable track:
 * drop the fixes that are wrong, and break the line where the machine stopped
 * reporting instead of pretending it travelled in a straight line.
 *
 * Three rules, in order, per point:
 *  1. **Accuracy** — a fix whose own error estimate exceeds `maxAccuracyM` is a
 *     wrong position (a Wi-Fi/cell-tower fix), so it is dropped outright.
 *  2. **Outage** — a gap of `gapS` or more means missing data, not movement.
 *     The point is kept and starts a NEW segment, so no line is drawn across it.
 *     Note the gap test runs *before* the speed test: after a real outage a
 *     large displacement is expected and must not be mistaken for noise.
 *  3. **Outlier** — an implied speed over `maxSpeedMs` or a single leg over
 *     `maxLegM` within a normal interval is noise; the point is dropped and the
 *     anchor stays put, so the track joins its neighbours rather than detouring.
 *
 * Why this is TypeScript and not a `LAG()` window in SQL: a window function
 * cannot re-anchor. Given one bad point it flags *both* adjoining legs and still
 * emits the bad point, leaving an orphan. Walking the list lets a single spike
 * cost exactly one dropped point. The `clean` CTE in `reports.service.ts` looks
 * similar but solves a different problem — it zeroes a bad *leg* for a distance
 * sum, where the fate of the point itself does not matter. Do not merge them.
 *
 * `maxConsecutiveRejects` is the guard against the opposite failure: if the
 * anchor itself is the bad fix, every later point would fail against it and the
 * rest of the day would silently vanish. After a few rejections in a row we
 * assume the anchor was wrong, break the segment and carry on.
 */
export function cleanRoutePoints<T extends CleanablePoint>(
  points: readonly T[],
  options: Partial<RouteCleanOptions> = {},
): RouteCleanResult<T> {
  const opts = { ...DEFAULTS, ...options };

  const kept: T[] = [];
  const segments: RouteSegment[] = [];
  let droppedLowAccuracy = 0;
  let droppedOutlier = 0;
  let droppedBadTimestamp = 0;

  let anchor: T | null = null;
  let anchorMs = 0;
  let segmentStart = 0;
  let consecutiveRejects = 0;

  const closeSegment = () => {
    if (kept.length > segmentStart) {
      segments.push({ startIndex: segmentStart, endIndex: kept.length - 1 });
    }
    segmentStart = kept.length;
  };

  for (const p of points) {
    const ms = Date.parse(p.recordedAt);
    if (!Number.isFinite(ms) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      droppedBadTimestamp++;
      continue;
    }
    if (p.accuracyM === null || !(p.accuracyM <= opts.maxAccuracyM)) {
      droppedLowAccuracy++;
      continue;
    }

    // Captured into a const so the null check below actually narrows: `anchor`
    // is reassigned further down and TypeScript will not carry a narrowing
    // across that.
    const prev = anchor;

    if (prev !== null) {
      const dtS = (ms - anchorMs) / 1000;
      if (dtS < 0) {
        // Defensive: the query orders by recorded_at, so this should not happen.
        droppedBadTimestamp++;
        continue;
      }

      if (dtS >= opts.gapS) {
        closeSegment();
      } else {
        const legM = haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
        const tooFar = legM > opts.maxLegM;
        // dtS === 0 means two fixes share a timestamp; there is no speed to
        // derive, so only the distance test applies.
        const tooFast = dtS > 0 && legM / dtS > opts.maxSpeedMs;

        if (tooFar || tooFast) {
          consecutiveRejects++;
          if (consecutiveRejects < opts.maxConsecutiveRejects) {
            droppedOutlier++;
            continue;
          }
          // Too many rejections in a row: the anchor was the bad fix, not all
          // of these. Re-anchor here and start a fresh segment.
          closeSegment();
        }
      }
    }

    kept.push(p);
    anchor = p;
    anchorMs = ms;
    consecutiveRejects = 0;
  }

  closeSegment();

  return {
    points: kept,
    segments,
    stats: {
      rawPoints: points.length,
      keptPoints: kept.length,
      droppedLowAccuracy,
      droppedOutlier,
      droppedBadTimestamp,
      segmentCount: segments.length,
    },
  };
}
