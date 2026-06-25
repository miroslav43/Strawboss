import type { Timestamps, SoftDelete } from '../common.js';

/** Which computed bale aggregate a manual adjustment corrects. */
export type BaleAdjustmentKind = 'produced' | 'loaded';

/**
 * A signed manual correction to a parcel's bale tally. Because "produced" and
 * "loaded" are computed aggregates (not stored columns), an admin override is
 * recorded as a signed delta the backend folds into the totals — `delta` may be
 * negative to lower a count below what operators recorded.
 */
export interface ParcelBaleAdjustment extends Timestamps, SoftDelete {
  id: string;
  organizationId: string;
  parcelId: string;
  kind: BaleAdjustmentKind;
  delta: number;
  reason: string | null;
  createdBy: string | null;
  /** Baler machine credited with producing these bales (only for kind='produced'). */
  balerId: string | null;
  syncVersion: number;
}

/** Computed bale tally for a parcel (base aggregates + manual adjustments). */
export interface ParcelBaleAvailability {
  produced: number;
  loaded: number;
  remaining: number;
}
