import type { Timestamps, SoftDelete } from '../common.js';

export interface BaleLoad extends Timestamps, SoftDelete {
  id: string;
  tripId: string;
  /** Parcel source — null for a depot-sourced load. Exactly one of parcelId / sourceDepotId is set. */
  parcelId: string | null;
  /** Depot source — set when the load is sourced from a depot instead of a parcel. */
  sourceDepotId: string | null;
  loaderId: string;
  operatorId: string;
  baleCount: number;
  loadedAt: string;
  gpsLat: number | null;
  gpsLon: number | null;
  farmtrackEventId: string | null;
  notes: string | null;
  /**
   * True when the loader confirmed registering this load while the app could
   * not verify their GPS presence against the field's boundary (offline, or
   * the boundary wasn't cached yet) — see migration 00094. `gpsLat`/`gpsLon`
   * are still recorded either way; this only flags the row for review.
   * `BaleLoadsService.list()` does `SELECT *` (snake_case), so a raw fetch
   * from `/api/v1/bale-loads` returns `location_unverified`, not this key —
   * map it explicitly if a consumer is added.
   */
  locationUnverified: boolean;
  clientId: string | null;
  syncVersion: number;
}
