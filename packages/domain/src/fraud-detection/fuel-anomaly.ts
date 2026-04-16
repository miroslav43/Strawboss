export interface FuelAnomalyInput {
  readings: number[];
  currentReading: number;
  stdDevThreshold: number;
}

export interface FuelAnomalyResult {
  mean: number;
  stdDev: number;
  zScore: number;
  isAnomaly: boolean;
}

export function detectFuelAnomaly(
  input: FuelAnomalyInput,
): FuelAnomalyResult {
  const { readings, currentReading, stdDevThreshold } = input;

  if (readings.length === 0) {
    return {
      mean: 0,
      stdDev: 0,
      zScore: 0,
      isAnomaly: false,
    };
  }

  const sum = readings.reduce((acc, val) => acc + val, 0);
  const mean = sum / readings.length;

  const squaredDiffs = readings.map((val) => (val - mean) ** 2);
  const variance =
    squaredDiffs.reduce((acc, val) => acc + val, 0) / readings.length;
  const stdDev = Math.sqrt(variance);

  // If stdDev is 0, all readings are the same; any deviation is anomalous
  const zScore = stdDev > 0 ? Math.abs(currentReading - mean) / stdDev : (currentReading !== mean ? Infinity : 0);

  const isAnomaly = zScore > stdDevThreshold;

  return {
    mean,
    stdDev,
    zScore,
    isAnomaly,
  };
}
