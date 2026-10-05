import { assertFraction } from './derived.js';
import type { StrawParams } from './params.js';

/**
 * Equilibrium moisture content of straw (DRY BASIS fraction) for air at
 * temperature `t` (°C) and relative humidity `rh` (fraction) — modified
 * Henderson. Rises with RH, falls with temperature.
 */
export function emcDb(t: number, rh: number, p: StrawParams['emc']): number {
  assertFraction(rh);
  const r = Math.min(Math.max(rh, 1e-4), 0.995);
  const denom = p.A * Math.max(t + p.C, 1);
  return Math.pow(-Math.log(1 - r) / denom, 1 / p.n);
}
