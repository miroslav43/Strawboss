export interface OdometerGpsInput {
  departureOdometerKm: number;
  arrivalOdometerKm: number;
  gpsDistanceKm: number;
  tolerancePercent: number;
}

export interface OdometerGpsResult {
  odometerDistanceKm: number;
  gpsDistanceKm: number;
  discrepancyKm: number;
  discrepancyPercent: number;
  isSuspicious: boolean;
}

export function checkOdometerGpsDiscrepancy(
  input: OdometerGpsInput,
): OdometerGpsResult {
  const {
    departureOdometerKm,
    arrivalOdometerKm,
    gpsDistanceKm,
    tolerancePercent,
  } = input;

  const odometerDistanceKm = arrivalOdometerKm - departureOdometerKm;
  const discrepancyKm = Math.abs(odometerDistanceKm - gpsDistanceKm);

  // Discrepancy as percentage of GPS distance (the more reliable reference)
  const discrepancyPercent =
    gpsDistanceKm > 0
      ? (discrepancyKm / gpsDistanceKm) * 100
      : 0;

  const isSuspicious = discrepancyPercent > tolerancePercent;

  return {
    odometerDistanceKm,
    gpsDistanceKm,
    discrepancyKm,
    discrepancyPercent,
    isSuspicious,
  };
}
