export interface TimingAnomalyInput {
  distanceKm: number;
  durationMinutes: number;
  maxSpeedKmh: number;
  minSpeedKmh: number;
}

export interface TimingAnomalyResult {
  avgSpeedKmh: number;
  isTooFast: boolean;
  isTooSlow: boolean;
  isSuspicious: boolean;
}

export function checkTimingAnomaly(
  input: TimingAnomalyInput,
): TimingAnomalyResult {
  const { distanceKm, durationMinutes, maxSpeedKmh, minSpeedKmh } = input;

  // Convert duration to hours for speed calculation
  const durationHours = durationMinutes / 60;

  const avgSpeedKmh =
    durationHours > 0 ? distanceKm / durationHours : 0;

  const isTooFast = avgSpeedKmh > maxSpeedKmh;
  const isTooSlow = avgSpeedKmh > 0 && avgSpeedKmh < minSpeedKmh;
  const isSuspicious = isTooFast || isTooSlow;

  return {
    avgSpeedKmh,
    isTooFast,
    isTooSlow,
    isSuspicious,
  };
}
