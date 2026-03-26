export interface FuelReconciliationInput {
  machineId: string;
  distanceKm: number;
  fuelUsedLiters: number;
  expectedConsumptionLPerKm: number;
  tolerancePercent: number;
}

export interface FuelReconciliationResult {
  machineId: string;
  expectedFuelLiters: number;
  actualFuelLiters: number;
  deviationPercent: number;
  isAnomaly: boolean;
}

export function reconcileFuel(
  input: FuelReconciliationInput,
): FuelReconciliationResult {
  const {
    machineId,
    distanceKm,
    fuelUsedLiters,
    expectedConsumptionLPerKm,
    tolerancePercent,
  } = input;

  const expectedFuelLiters = distanceKm * expectedConsumptionLPerKm;

  // Deviation as percentage of expected
  const deviationPercent =
    expectedFuelLiters > 0
      ? ((fuelUsedLiters - expectedFuelLiters) / expectedFuelLiters) * 100
      : 0;

  const isAnomaly = Math.abs(deviationPercent) > tolerancePercent;

  return {
    machineId,
    expectedFuelLiters,
    actualFuelLiters: fuelUsedLiters,
    deviationPercent,
    isAnomaly,
  };
}
