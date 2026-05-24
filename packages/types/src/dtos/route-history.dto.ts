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
