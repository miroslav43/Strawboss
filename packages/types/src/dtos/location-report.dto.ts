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
