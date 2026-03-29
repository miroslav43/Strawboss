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
