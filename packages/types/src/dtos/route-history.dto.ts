/** A single GPS point in a vehicle's route history. */
export interface RoutePoint {
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMs: number | null;
  recordedAt: string;
}

/**
 * A contiguous run of points with no reporting outage between them. Both ends
 * are inclusive indices into `RouteHistoryResponse.points`.
 *
 * A track is drawn as one polyline PER SEGMENT. Drawing a single line through
 * every point would connect the two sides of an outage with a straight leg the
 * machine never travelled.
 */
export interface RouteSegment {
  startIndex: number;
  endIndex: number;
}

/**
 * What the server removed before returning the track, so the UI can say
 * "N points (M filtered)" instead of silently showing less data.
 */
export interface RouteFilterStats {
  /** Points matching the time window before any noise filtering. */
  rawPoints: number;
  /** Points actually returned. */
  keptPoints: number;
  /** Dropped because the device's own accuracy estimate was too poor. */
  droppedLowAccuracy: number;
  /** Dropped because the implied speed or leg length was impossible. */
  droppedOutlier: number;
  /** Dropped because the timestamp or coordinates were unusable. */
  droppedBadTimestamp: number;
  /** Lone points that left the path and came straight back (GPS excursions). */
  droppedSpike: number;
  /** Accuracy ceiling applied, in metres. `null` when no accuracy gate ran. */
  accuracyCapM: number | null;
  /** True when the row cap was hit and the track is incomplete. */
  truncated: boolean;
}

/** Response from GET /api/v1/location/machines/:machineId/route */
export interface RouteHistoryResponse {
  machineId: string;
  machineCode: string | null;
  machineType: string | null;
  from: string;
  to: string;
  /** Number of points returned (i.e. `points.length`), after filtering. */
  totalPoints: number;
  points: RoutePoint[];
  /** Absent on legacy responses; treat as a single segment over all points. */
  segments?: RouteSegment[];
  /** Absent on legacy responses. */
  filter?: RouteFilterStats;
}

/** A single day in the per-truck kilometre rollup (T18). */
export interface KmByDayPoint {
  /** ISO date `YYYY-MM-DD` (UTC partition). */
  date: string;
  /** Kilometres travelled that day, rounded to two decimals. */
  km: number;
  /** Number of GPS samples used for the per-day pairwise distance sum. */
  pointCount: number;
}

/** Response from GET /api/v1/location/machines/:machineId/km-by-day */
export interface KmByDayResponse {
  machineId: string;
  machineCode: string | null;
  machineType: string | null;
  from: string;
  to: string;
  days: KmByDayPoint[];
}

/**
 * One (truck, day) row from the bulk per-truck distance report (T18).
 * Returned by GET /api/v1/reports/truck-distance.
 */
export interface TruckDistanceRow {
  machineId: string;
  machineCode: string | null;
  registrationPlate: string | null;
  /** ISO date `YYYY-MM-DD` (UTC partition). */
  date: string;
  /** Kilometres travelled that day, rounded to two decimals. Noise-capped. */
  distanceKm: number;
  /** Number of GPS samples used. */
  pointCount: number;
  /** Driver who logged the most GPS points that day (null if unattributed). */
  operatorName?: string | null;
}

/**
 * One (operator, day) row from the per-operator GPS-distance report.
 * Returned by GET /api/v1/reports/operator-distance. Distance is attributed to
 * the driver via machine_location_events.operator_id (trucks only).
 */
export interface OperatorDistanceRow {
  operatorId: string;
  operatorName: string | null;
  /** ISO date `YYYY-MM-DD` (UTC partition). */
  date: string;
  /** Kilometres driven that day, rounded to two decimals. Noise-capped. */
  distanceKm: number;
  /** Number of GPS samples used. */
  pointCount: number;
}

/**
 * Per-truck "today / this week" summary, surfaced on the Machines admin page
 * (T18). Returned by GET /api/v1/reports/truck-distance/summary.
 */
export interface TruckDistanceSummary {
  machineId: string;
  kmToday: number;
  kmThisWeek: number;
}
