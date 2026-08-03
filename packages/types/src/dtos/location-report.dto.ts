export interface LocationReportDto {
  machineId: string;
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres */
  accuracyM?: number | null;
  /** Compass heading in degrees (0–360) */
  headingDeg?: number | null;
  /** Speed in metres per second */
  speedMs?: number | null;
  /** ISO-8601 timestamp when the position was recorded on the device */
  recordedAt: string;
  /**
   * Where the fix came from. `task` = the location foreground service (a real
   * tracking fix); `checkin` = the 60 s presence alarm's best-effort fix
   * (last-known + Balanced — network quality, for presence/geofence only,
   * never drawn as a track). Absent on APKs older than vc56; the server
   * stores that as NULL and treats it as `task`.
   */
  source?: 'task' | 'checkin';
}

/**
 * Body for POST /location/report/batch — 1–30 GPS pings collected while the
 * mobile device was offline, each with the exact same shape as the single
 * POST /location/report body. Max array size (30) is enforced server-side.
 */
export interface LocationReportBatchDto {
  reports: LocationReportDto[];
}
