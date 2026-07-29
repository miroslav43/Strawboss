import type { Parcel } from '@strawboss/types';

/**
 * Single source of truth for bale-tally arithmetic so the parcels table and
 * the map badge/tooltip can never disagree — both must call these helpers
 * instead of computing produced/loaded/remaining inline.
 */
type BaleTallies = Pick<Parcel, 'balesProduced' | 'balesLoaded'>;

/**
 * True only when the parcel came from an endpoint that carries tallies
 * (GET /parcels list()). GET /parcels/:id leaves both fields undefined —
 * callers should omit any bale UI rather than assume 0.
 */
export function hasBaleTallies(p: BaleTallies): boolean {
  return p.balesProduced !== undefined || p.balesLoaded !== undefined;
}

/**
 * Bales still lying in the field. Unclamped on purpose — matches the parcels
 * table exactly. Can be negative when an admin over-corrects via
 * parcel_bale_adjustments (see ParcelsService.overrideBales).
 */
export function remainingBales(p: BaleTallies): number {
  return Number(p.balesProduced ?? 0) - Number(p.balesLoaded ?? 0);
}

/**
 * Badge visibility predicate. Clamping happens ONLY here, never inside
 * remainingBales() — otherwise the map would show 0 where the table shows a
 * negative correction.
 */
export function shouldShowBaleBadge(p: BaleTallies): boolean {
  return hasBaleTallies(p) && remainingBales(p) > 0;
}

/** Hectares from API may be number or string (Postgres numeric → JSON). */
export function parseHa(ha: unknown): number | null {
  if (ha == null || ha === '') return null;
  const n = typeof ha === 'number' ? ha : Number(String(ha).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function fmtHa(ha: unknown): string {
  const n = parseHa(ha);
  if (n == null) return '—';
  return `${n.toFixed(2).replace('.', ',')} ha`;
}
