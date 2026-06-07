/** A single GPS point in a vehicle's route history. */
export interface RoutePoint {
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMs: number | null;
  recordedAt: string;
}

/** Response from GET /api/v1/location/machines/:machineId/route */
export interface RouteHistoryResponse {
  machineId: string;
  machineCode: string | null;
  machineType: string | null;
  from: string;
  to: string;
  totalPoints: number;
  points: RoutePoint[];
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
