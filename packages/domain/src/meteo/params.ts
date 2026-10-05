import type { SwathType } from '@strawboss/types';

/**
 * Straw drying-model parameters. EVERY number here is a starting point, not a
 * calibrated value — they are chosen so a clear summer day (Rs≈600 W/m²,
 * VPD≈2 kPa, wind≈3 m/s) takes straw from ~30 % to ~15 % wet basis in roughly
 * ten daylight hours, which matches field experience for cereal straw in a
 * swath. The first harvest season's moisture readings replace them
 * (least-squares fit, see the Meteo design doc §3.7); bump `modelVersion` when
 * they change so frozen fingerprints keep saying which model produced them.
 */
export interface StrawParams {
  modelVersion: string;
  /** Drying rate per hour: k = f_swath · (k0 + k1·Rs + k2·VPD + k3·u). */
  k0: number;
  k1: number;
  k2: number;
  k3: number;
  /** Re-wetting rate per hour when the straw is below its equilibrium. */
  kWet: number;
  /** Dry-basis moisture gained per mm of rain. */
  beta: number;
  /** Dry-basis saturation cap for rain wetting. */
  mcSatDb: number;
  swathFactor: Record<SwathType, number>;
  /**
   * Modified-Henderson isotherm M = [−ln(1−RH) / (A·(T+C))]^(1/n), M in DRY
   * BASIS fraction. A and n are solved from the two literature anchors at
   * T = 20 °C (aw 0.70 → 14 % wet basis; RH 0.85 → 27 % dry basis — see the
   * design doc §2.5). C is a placeholder in the range of cereal isotherms
   * (ASABE D245: C ≈ 40–65 °C) until calibration supplies one.
   */
  emc: { A: number; C: number; n: number };
  /** RH used for the equilibrium during a dew hour. */
  dewRh: number;
  /** Hourly rain threshold (mm) for a native 1-hour step. */
  rainThresholdMm: number;
  /** Soil-access thresholds (placeholders until the access-feedback button). */
  access: {
    sm07NoGo: number;
    sm07Marginal: number;
    rain48hNoGoMm: number;
    rain48hMarginalMm: number;
  };
}

const EMC_T_REF = 20;
const EMC_C = 50;
// Anchors: (RH 0.70, M = 0.14/0.86) and (RH 0.85, M = 0.27), both at 20 °C.
const EMC_N =
  (Math.log(-Math.log(1 - 0.85)) - Math.log(-Math.log(1 - 0.7))) /
  (Math.log(0.27) - Math.log(0.14 / 0.86));
const EMC_X = Math.exp(Math.log(-Math.log(1 - 0.7)) - EMC_N * Math.log(0.14 / 0.86));

export const STRAW_PARAMS_V1: StrawParams = {
  modelVersion: 'straw-v1-uncalibrated',
  k0: 0.02,
  k1: 1.2e-4,
  k2: 0.02,
  k3: 0.005,
  kWet: 0.05,
  beta: 0.03,
  mcSatDb: 1.5,
  swathFactor: { narrow: 0.8, wide: 1, turned: 1.25 },
  emc: { A: EMC_X / (EMC_T_REF + EMC_C), C: EMC_C, n: EMC_N },
  dewRh: 0.99,
  rainThresholdMm: 0.2,
  access: {
    sm07NoGo: 0.4,
    sm07Marginal: 0.32,
    rain48hNoGoMm: 25,
    rain48hMarginalMm: 10,
  },
};
