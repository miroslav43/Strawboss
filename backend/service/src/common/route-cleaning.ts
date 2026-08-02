import {
  GAP_SPLIT_S,
  SEGMENT_CAP_M,
  SPEED_CAP_MS,
  SPIKE_DETOUR_RATIO,
  SPIKE_MAX_LEG_S,
  SPIKE_MIN_EXCURSION_M,
} from './gps-noise';

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
  /**
   * Accuracy ceiling in metres. Defaults to `Infinity` — no gate.
   *
   * This used to default to 100 m and it was a mistake worth remembering: it
   * threw away 35% of a healthy day's points for no gain in cleanliness (the
   * kinematic tests below already removed every impossible leg on their own),
   * and because it deletes runs of consecutive fixes it opened holes wide
   * enough to trip the outage split — turning 9 real gaps into 38 and shredding
   * a continuous track into fragments. Judge the relationship between points,
   * not the label on one point.
   */
  maxAccuracyM: number;
  maxSpeedMs: number;
  maxLegM: number;
  gapS: number;
  /**
   * After this many points in a row fail against the current anchor, conclude
   * that the ANCHOR was the outlier rather than all of them, and re-anchor.
   */
  maxConsecutiveRejects: number;
  /** Detour multiple above which a lone point counts as an excursion. */
  spikeDetourRatio: number;
  /** Excursions shorter than this are ordinary jitter. */
  spikeMinExcursionM: number;
  /** Do not despike when fixes are further apart than this. */
  spikeMaxLegS: number;
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
  /** Lone points that left the path and came straight back. */
  droppedSpike: number;
  segmentCount: number;
}

export interface RouteCleanResult<T> {
  points: T[];
  segments: RouteSegment[];
  stats: RouteCleanStats;
}

const DEFAULTS: RouteCleanOptions = {
  // No accuracy gate by default — see RouteCleanOptions.maxAccuracyM.
  maxAccuracyM: Number.POSITIVE_INFINITY,
  maxSpeedMs: SPEED_CAP_MS,
  maxLegM: SEGMENT_CAP_M,
  gapS: GAP_SPLIT_S,
  // 5 rather than 3: tolerating a little more noise before re-anchoring cut the
  // segment count from 130 to 93 over ten days while keeping 95% of points.
  maxConsecutiveRejects: 5,
  spikeDetourRatio: SPIKE_DETOUR_RATIO,
  spikeMinExcursionM: SPIKE_MIN_EXCURSION_M,
  spikeMaxLegS: SPIKE_MAX_LEG_S,
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
    // Only gate on accuracy when a finite ceiling was asked for. With the
    // default (Infinity) a missing estimate is not a reason to discard a fix.
    if (Number.isFinite(opts.maxAccuracyM) && !(Number(p.accuracyM) <= opts.maxAccuracyM)) {
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

  const despiked = removeExcursions(kept, segments, opts);

  return {
    points: despiked.points,
    segments: despiked.segments,
    stats: {
      rawPoints: points.length,
      keptPoints: despiked.points.length,
      droppedLowAccuracy,
      droppedOutlier,
      droppedBadTimestamp,
      droppedSpike: despiked.dropped,
      segmentCount: despiked.segments.length,
    },
  };
}

/**
 * Second pass: drop lone points that leave the path and come straight back.
 *
 * The forward pass cannot catch these. It only ever compares a point to the one
 * anchor behind it, and each half of an excursion is individually plausible — 4
 * km in 3 minutes is 80 km/h, a legal speed. What gives it away is the shape:
 * travelling via the point is several times longer than skipping it. That needs
 * the point AFTER, so it lives here rather than in the streaming loop.
 *
 * Runs within a segment only: across an outage boundary the geometry means
 * nothing. `spikeMaxLegS` applies the same caution inside a segment — when
 * fixes are minutes apart the machine really could have driven out and back.
 *
 * Deliberately a single sweep with a moving reference: after a point is
 * rejected the next comparison still anchors on the last KEPT point, so two
 * adjacent excursions are both caught, while a genuine turn is not re-judged
 * against a point that was itself thrown away.
 */
function removeExcursions<T extends CleanablePoint>(
  points: readonly T[],
  segments: readonly RouteSegment[],
  opts: RouteCleanOptions,
): { points: T[]; segments: RouteSegment[]; dropped: number } {
  const out: T[] = [];
  const nextSegments: RouteSegment[] = [];
  let dropped = 0;

  for (const seg of segments) {
    const segmentStart = out.length;
    let prevIdx = -1;

    for (let i = seg.startIndex; i <= seg.endIndex; i++) {
      const p = points[i];
      const isInterior = prevIdx >= 0 && i < seg.endIndex;

      if (isInterior) {
        const prev = points[prevIdx];
        const next = points[i + 1];
        const outM = haversineMeters(prev.lat, prev.lon, p.lat, p.lon);

        if (outM > opts.spikeMinExcursionM) {
          const dtOut = (Date.parse(p.recordedAt) - Date.parse(prev.recordedAt)) / 1000;
          const dtBack = (Date.parse(next.recordedAt) - Date.parse(p.recordedAt)) / 1000;

          if (dtOut <= opts.spikeMaxLegS && dtBack <= opts.spikeMaxLegS) {
            const backM = haversineMeters(p.lat, p.lon, next.lat, next.lon);
            const directM = haversineMeters(prev.lat, prev.lon, next.lat, next.lon);
            // Guard the ratio: when prev and next are effectively the same
            // place, any excursion at all is a round trip to nowhere.
            const detour = directM > 1 ? (outM + backM) / directM : Number.POSITIVE_INFINITY;

            if (detour > opts.spikeDetourRatio) {
              dropped++;
              continue;
            }
          }
        }
      }

      prevIdx = i;
      out.push(p);
    }

    if (out.length > segmentStart) {
      nextSegments.push({ startIndex: segmentStart, endIndex: out.length - 1 });
    }
  }

  return { points: out, segments: nextSegments, dropped };
}
