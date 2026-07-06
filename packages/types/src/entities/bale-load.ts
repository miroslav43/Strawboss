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
  clientId: string | null;
  syncVersion: number;
}
