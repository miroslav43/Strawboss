import { emcDb } from './emc.js';
import { vpdKPa } from './derived.js';
import type { StrawParams } from './params.js';

/** One simulated hour. `null` weather means "no data": the state is held. */
export interface SimHour {
  t2m: number | null;
  rh: number | null;
  td: number | null;
  windMs: number | null;
  rsWm2: number | null;
  precipMm: number | null;
  rain: boolean;
  dew: boolean;
  /** Force the state to this dry-basis value at the END of the hour (a reading). */
  resetDb?: number | null;
}

export type SimBranch = 'rain' | 'dew' | 'drying' | 'wetting' | 'hold';

export interface SimStep {
  mcDb: number;
  branch: SimBranch;
}

/**
 * Advance straw moisture one hour (design doc §3.1–3.2):
 *  - rain: absorb β·P, capped at saturation — never DRIES (max with current);
 *  - dew:  relax toward the equilibrium at RH≈0.99 at the re-wetting rate;
 *  - else: relax exponentially toward the equilibrium of the hour's air, at the
 *          drying rate k = f·(k0+k1·Rs+k2·VPD+k3·u) when above it, or at the
 *          re-wetting rate when below it.
 */
export function stepHour(mcDb: number, h: SimHour, p: StrawParams, swathFactor: number): SimStep {
  if (h.rain) {
    const wet = Math.min(mcDb + p.beta * (h.precipMm ?? 0), p.mcSatDb);
    return { mcDb: Math.max(mcDb, wet), branch: 'rain' };
  }
  if (h.t2m === null || h.rh === null) return { mcDb, branch: 'hold' };
  if (h.dew) {
    const me = emcDb(h.t2m, p.dewRh, p.emc);
    if (mcDb >= me) return { mcDb, branch: 'dew' };
    return { mcDb: me + (mcDb - me) * Math.exp(-p.kWet), branch: 'dew' };
  }
  const me = emcDb(h.t2m, h.rh, p.emc);
  if (mcDb > me) {
    const rs = h.rsWm2 ?? 0;
    const vpd = h.td !== null ? vpdKPa(h.t2m, h.td) : 0;
    const u = h.windMs ?? 0;
    const k = Math.max(0, swathFactor * (p.k0 + p.k1 * rs + p.k2 * vpd + p.k3 * u));
    return { mcDb: me + (mcDb - me) * Math.exp(-k), branch: 'drying' };
  }
  return { mcDb: me + (mcDb - me) * Math.exp(-p.kWet), branch: 'wetting' };
}

/** Simulate a whole series; returns the dry-basis state at the END of each hour. */
export function simulate(
  mc0Db: number,
  hours: readonly SimHour[],
  p: StrawParams,
  swathFactor: number,
): SimStep[] {
  let mc = mc0Db;
  const out: SimStep[] = [];
  for (const h of hours) {
    const s = stepHour(mc, h, p, swathFactor);
    mc = h.resetDb ?? s.mcDb;
    out.push({ mcDb: mc, branch: s.branch });
  }
  return out;
}
