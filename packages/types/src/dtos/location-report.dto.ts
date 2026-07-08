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
}

/**
 * Body for POST /location/report/batch — 1–30 GPS pings collected while the
 * mobile device was offline, each with the exact same shape as the single
 * POST /location/report body. Max array size (30) is enforced server-side.
 */
export interface LocationReportBatchDto {
  reports: LocationReportDto[];
}
